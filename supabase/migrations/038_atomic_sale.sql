-- =============================================================================
-- 038 — One atomic sale
--
-- Phase 2.1 of docs/PERF-REFACTOR-PLAN.md, and the fix for audit P1-4 and
-- P1-11.
--
-- WHAT IT REPLACES
-- ----------------
-- `POST /api/transactions` currently takes THREE serial waves from the Vercel
-- function to Postgres while a customer stands at the counter:
--
--   1. resolve the cash shift   (SELECT)
--   2. insert the transaction   (INSERT ... RETURNING)
--   3. insert the line items AND apply the stock decrements  (parallel pair)
--
-- Each wave pays full network latency. On the measured baseline the API leg of
-- a sale is the largest thing between "cashier presses F4" and "the money is
-- recorded", and none of the three waves needs to be a separate trip: wave 1
-- reads nothing the client did not already imply, and wave 3 depends only on
-- the id wave 2 produced.
--
-- This collapses all of it into ONE call and ONE transaction.
--
-- ATOMICITY IS THE POINT, NOT A SIDE EFFECT
-- -----------------------------------------
-- Today a sale can be half-written: the transaction row commits, then the
-- items insert fails and is deliberately swallowed (the sale is already
-- created, so failing the request would be worse). The result is a sale with
-- no lines — an empty receipt, an empty kitchen ticket, and analytics that
-- silently under-count. That is audit P1-4. Inside one function the three
-- writes share one transaction: all of it lands, or none of it does.
--
-- WHAT MUST NOT CHANGE, AND DOES NOT
-- ----------------------------------
--   * Idempotency is still UNIQUE (store_id, transaction_number). A repeat
--     returns the existing sale with duplicated = true, exactly as the 23505
--     branch did, and does NOT re-apply stock.
--   * The shift is resolved from the sale's OWN created_at against the
--     assigned shift's window — never "what is open right now". That is what
--     keeps an offline sale on the shift it was actually rung in.
--   * `modifiers` keeps the NULL vs [] distinction. NULL is an ordinary retail
--     line; [] is a menu line where nothing was changed, and the kitchen board
--     filters on `modifiers IS NOT NULL`.
--   * Client-supplied `stock_decrements` take priority over `items`, because
--     the recipe AT THE TIME OF SALE is the right recipe.
--   * A sale is NEVER refused for cash-register or stock reasons.
--
-- WHAT DOES CHANGE — audit P1-11
-- ------------------------------
-- A `user_id` that does not name a live `store_users` row for this store is
-- coerced to NULL instead of raising 23503 on transactions_user_id_fkey.
--
-- Today that FK violation returns 500, the client reads any 500 as an offline
-- condition, retries, exhausts its five attempts and DEAD-LETTERS the sale:
-- money taken at the till, sale never recorded. It needs only that a cashier
-- rang sales offline and was then removed as an employee (a hard delete) while
-- their till was still holding the queue.
--
-- Shift resolution already degrades exactly this way — an unresolvable shift
-- yields a NULL shift_id and the Unassigned bucket, and the sale stands. The
-- user reference now degrades the same way. `user_name` is stored
-- denormalised alongside it, so WHO rang the sale is not lost.
--
-- ADDITIVE AND REVERSIBLE
-- -----------------------
-- The route calls this and falls back to its existing multi-step path when the
-- function is absent (PGRST202 / 42883), so this migration and the code that
-- uses it can be deployed in either order.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_sale(p_store_id UUID, p_sale JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn            transactions%ROWTYPE;
  v_created_at     TIMESTAMPTZ;
  v_user_id        UUID;
  v_shift_id       UUID;
  v_register_id    UUID;
  v_number         TEXT;
  v_inserted       BOOLEAN := FALSE;
  v_decrements     JSONB;
BEGIN
  v_number := p_sale->>'transaction_number';
  IF v_number IS NULL OR v_number = '' THEN
    RAISE EXCEPTION 'transaction_number is required';
  END IF;

  -- ---------------------------------------------------------------------------
  -- created_at: honour the till's clock, but clamp the future.
  --
  -- An offline sale MUST keep the moment it happened (audit P1-1) or a
  -- multi-day outage is all recorded as having happened when the link came
  -- back, which corrupts shift reconciliation and every hourly report.
  --
  -- Shop-floor clocks drift, though, and a future timestamp would put a sale
  -- in a shift that has not started. Anything ahead of the server is pulled
  -- back to now; anything unparseable falls through to NOW().
  -- ---------------------------------------------------------------------------
  BEGIN
    v_created_at := LEAST((p_sale->>'created_at')::TIMESTAMPTZ, NOW());
  EXCEPTION WHEN OTHERS THEN
    v_created_at := NOW();
  END;
  IF v_created_at IS NULL THEN
    v_created_at := NOW();
  END IF;

  -- ---------------------------------------------------------------------------
  -- user_id: degrade to NULL rather than refusing the sale. (audit P1-11)
  --
  -- Scoped to this store, so a forged id from another tenant is also dropped
  -- rather than recorded.
  -- ---------------------------------------------------------------------------
  BEGIN
    v_user_id := (p_sale->>'user_id')::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  IF v_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM store_users su
    WHERE su.id = v_user_id AND su.store_id = p_store_id
  ) THEN
    v_user_id := NULL;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Which drawer? Resolved from WHO rang it, matched on the sale's OWN time.
  --
  -- Best effort throughout: a sale is never failed or delayed for cash-register
  -- reasons. No match simply means a NULL shift_id and the Unassigned bucket.
  -- ---------------------------------------------------------------------------
  SELECT cs.id, cs.register_id
    INTO v_shift_id, v_register_id
  FROM cash_shifts cs
  WHERE cs.store_id = p_store_id
    AND cs.opened_at <= v_created_at
    AND (cs.closed_at IS NULL OR cs.closed_at >= v_created_at)
    AND (
      (v_user_id IS NOT NULL AND cs.assigned_user_id = v_user_id)
      OR (v_user_id IS NULL AND cs.assigned_to_owner = TRUE)
    )
  ORDER BY cs.opened_at DESC
  LIMIT 1;

  -- ---------------------------------------------------------------------------
  -- The sale. ON CONFLICT DO NOTHING is the idempotency hinge: a replayed
  -- queued sale inserts nothing and falls through to the duplicate branch,
  -- WITHOUT re-applying stock.
  -- ---------------------------------------------------------------------------
  INSERT INTO transactions (
    store_id, transaction_number, receipt_token, created_at,
    subtotal, total_amount, amount_paid, change_given, payment_method,
    usd_subtotal, usd_total_amount, usd_amount_paid, usd_change_given,
    user_id, user_name, shift_id, register_id
  )
  VALUES (
    p_store_id,
    v_number,
    NULLIF(p_sale->>'receipt_token', ''),
    v_created_at,
    COALESCE((p_sale->>'subtotal')::NUMERIC, 0),
    COALESCE((p_sale->>'total_amount')::NUMERIC, 0),
    COALESCE((p_sale->>'amount_paid')::NUMERIC, 0),
    COALESCE((p_sale->>'change_given')::NUMERIC, 0),
    COALESCE(NULLIF(p_sale->>'payment_method', ''), 'cash'),
    COALESCE((p_sale->>'usd_subtotal')::NUMERIC, 0),
    COALESCE((p_sale->>'usd_total_amount')::NUMERIC, 0),
    COALESCE((p_sale->>'usd_amount_paid')::NUMERIC, 0),
    COALESCE((p_sale->>'usd_change_given')::NUMERIC, 0),
    v_user_id,
    NULLIF(p_sale->>'user_name', ''),
    v_shift_id,
    v_register_id
  )
  ON CONFLICT (store_id, transaction_number) DO NOTHING
  RETURNING * INTO v_txn;

  v_inserted := v_txn.id IS NOT NULL;

  IF NOT v_inserted THEN
    -- Already recorded. Return it unchanged, apply nothing.
    --
    -- The nested line items are included because the route's existing 23505
    -- branch returned them, and the API contract snapshot records that shape.
    -- A replay is the one case where the caller may not have the sale locally
    -- any more, so handing back the whole thing is also the useful answer.
    SELECT * INTO v_txn
    FROM transactions t
    WHERE t.store_id = p_store_id AND t.transaction_number = v_number;

    RETURN jsonb_build_object(
      'transaction',
      to_jsonb(v_txn) || jsonb_build_object(
        'transaction_items',
        COALESCE((
          SELECT jsonb_agg(to_jsonb(ti) ORDER BY ti.id)
          FROM transaction_items ti
          WHERE ti.transaction_id = v_txn.id
            AND ti.store_id = p_store_id
        ), '[]'::jsonb)
      ),
      'duplicated', TRUE
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- Line items.
  --
  -- `modifiers` uses the raw JSON value with a JSON-null guard, so an absent
  -- key and an explicit null both become SQL NULL while `[]` survives as `[]`.
  -- Collapsing those would make a retail store see every sale as a kitchen
  -- ticket, or hide a real one.
  -- ---------------------------------------------------------------------------
  INSERT INTO transaction_items (
    store_id, transaction_id, product_id, product_name,
    quantity, unit_price, total_price, currency, modifiers, note, combo_children
  )
  SELECT
    p_store_id,
    v_txn.id,
    CASE
      WHEN item->>'product_id' IS NULL THEN NULL
      WHEN item->>'product_id' = '' THEN NULL
      -- A synthetic one-off key ("oneoff:<uuid>") is not a product and must
      -- never reach this FK.
      WHEN item->>'product_id' LIKE 'oneoff:%' THEN NULL
      ELSE (item->>'product_id')::UUID
    END,
    COALESCE(item->>'product_name', ''),
    COALESCE((item->>'quantity')::INTEGER, 0),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'total_price')::NUMERIC, 0),
    COALESCE(NULLIF(item->>'currency', ''), 'LL'),
    NULLIF(item->'modifiers', 'null'::jsonb),
    NULLIF(item->>'note', ''),
    NULLIF(item->'combo_children', 'null'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_sale->'items', '[]'::jsonb)) AS item;

  -- ---------------------------------------------------------------------------
  -- Stock.
  --
  -- Client-supplied decrements win: a made-to-order line consumes its
  -- INGREDIENTS and `items` only names the sandwich. The COALESCE fallback is
  -- the compatibility hinge for every sale already sitting in a device's queue
  -- and for any client that has not updated.
  --
  -- Stock is allowed to go negative. A sale is never blocked for want of an
  -- ingredient — that is a live till, and a refused sale costs a real customer.
  -- ---------------------------------------------------------------------------
  v_decrements := CASE
    WHEN jsonb_typeof(p_sale->'stock_decrements') = 'array'
      THEN p_sale->'stock_decrements'
    ELSE (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'product_id', item->>'product_id',
               'quantity',   item->>'quantity'
             )), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(p_sale->'items', '[]'::jsonb)) AS item
      WHERE item->>'product_id' IS NOT NULL
        AND item->>'product_id' <> ''
        AND item->>'product_id' NOT LIKE 'oneoff:%'
    )
  END;

  UPDATE products p
  SET stock_quantity = p.stock_quantity - d.qty
  FROM (
    SELECT (e->>'product_id')::UUID AS pid,
           SUM(COALESCE((e->>'quantity')::NUMERIC, 0))::INTEGER AS qty
    FROM jsonb_array_elements(v_decrements) AS e
    WHERE e->>'product_id' IS NOT NULL
      AND e->>'product_id' <> ''
      AND e->>'product_id' NOT LIKE 'oneoff:%'
      AND COALESCE((e->>'quantity')::NUMERIC, 0) > 0
    GROUP BY 1
  ) AS d(pid, qty)
  WHERE p.id = d.pid
    AND p.store_id = p_store_id;  -- tenancy: a foreign id is a no-op, not a write

  RETURN jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'duplicated', FALSE
  );
END;
$$;

COMMENT ON FUNCTION create_sale(UUID, JSONB) IS
  'Records one sale atomically: transaction + line items + stock, in a single '
  'round trip and a single database transaction. Idempotent on '
  '(store_id, transaction_number). Never refuses a sale for cash-register, '
  'stock or unknown-user reasons. See migration 038.';

-- The route calls this with the service-role client. Nothing else should be
-- able to write a sale directly.
REVOKE ALL ON FUNCTION create_sale(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_sale(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION create_sale(UUID, JSONB) TO service_role;

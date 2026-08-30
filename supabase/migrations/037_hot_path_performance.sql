-- =============================================================================
-- 037 — Hot-path performance
--
-- Four changes, all aimed at the same thing: the server work that happens
-- while a customer is standing at the till, and the one report query that was
-- both slow AND silently wrong.
--
--   1. Drop the per-row cleanup trigger that ran on EVERY sale.
--   2. decrement_stock_batch() — one round trip instead of one per line.
--   3. get_transaction_analytics() — aggregate in Postgres, not in JS.
--   4. Drop four duplicate indexes on `transactions` (every sale wrote to all
--      of them).
--
-- Every function here is additive. The routes that call them fall back to
-- their previous behaviour when the function is absent, so this migration and
-- the code that uses it can be deployed in either order.
-- =============================================================================


-- =============================================================================
-- 1. Remove the auto-cleanup trigger from the sale path
--
-- 012_auto_cleanup_trigger.sql installed an AFTER INSERT ... FOR EACH ROW
-- trigger on `transactions` that, for every single sale:
--
--   * SELECTs the store's retention settings,
--   * runs `SELECT COUNT(*) FROM transactions WHERE store_id = ...` — a full
--     count over the store's entire sales history,
--   * conditionally DELETEs the excess oldest rows,
--   * and ALWAYS runs a second DELETE for the time-based cutoff, whether or
--     not anything is old enough to delete.
--
-- All of that ran inside the transaction that takes the customer's money, and
-- FOR EACH ROW means a batched insert paid it once per row. On a store at the
-- 5,000-transaction default that is a 5,000-row count plus two delete scans
-- per sale, which is most of the reason POST /api/transactions is slow.
--
-- It is also redundant. 013_scheduled_cleanup.sql already implements exactly
-- this policy in `scheduled_transaction_cleanup()`, and
-- `cleanup_old_transactions_for_store()` does it for one store — the latter is
-- what `DELETE /api/transactions` calls. Retention is now driven from
-- POST /api/transactions opportunistically (at most once per hour per server
-- instance, after the response has been sent, via `after()`), the same pattern
-- POST /api/activity already uses for partition maintenance. Nothing about the
-- retention POLICY changes; only when and where it runs.
--
-- The function is dropped too — leaving it behind invites someone to re-attach
-- the trigger. `scheduled_transaction_cleanup()` is the supported entry point.
-- =============================================================================

DROP TRIGGER IF EXISTS trigger_auto_cleanup_transactions ON transactions;
DROP FUNCTION IF EXISTS auto_cleanup_transactions();

-- If pg_cron happens to be enabled on this project, also drive the sweep from
-- there so retention does not depend on sales traffic at all. Guarded, because
-- the extension is off by default on Supabase and a hard reference would make
-- this migration fail on projects without it.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'goldensquirrel_transaction_cleanup') THEN
      PERFORM cron.unschedule('goldensquirrel_transaction_cleanup');
    END IF;
    PERFORM cron.schedule(
      'goldensquirrel_transaction_cleanup',
      '17 3 * * *',                                   -- 03:17 daily, off-peak
      'SELECT scheduled_transaction_cleanup()'
    );
  END IF;
END
$cron$;


-- =============================================================================
-- 2. decrement_stock_batch — every line of a sale in ONE round trip
--
-- POST /api/transactions looped over the sale's lines and awaited a separate
-- `decrement_stock` RPC for each one. A ten-line sale was ten serial round
-- trips from the Vercel function to Postgres, on top of the inserts — and a
-- made-to-order sandwich decrements its INGREDIENTS, so a food order's list is
-- longer than its line count.
--
-- Semantics are deliberately identical to calling decrement_stock in a loop:
--   * store-scoped, so a foreign product_id is a no-op UPDATE, not an error;
--   * stock is allowed to go negative (a sale is never blocked for want of an
--     ingredient — see CLAUDE.md §13);
--   * a product_id that matches nothing is silently skipped.
--
-- The one behavioural improvement: repeated product_ids are summed first, so a
-- product appearing on two lines is a single UPDATE rather than two.
--
-- Rounding is applied to the SUMMED quantity, matching buildStockDecrements()
-- on the client, which integerises once at the whole line rather than per unit.
--
-- p_store_id is NOT NULL-defaulted. decrement_stock's legacy
-- "NULL means skip the tenancy check" branch is a privilege hole (audit P0-5)
-- and is deliberately not reproduced here.
-- =============================================================================

CREATE OR REPLACE FUNCTION decrement_stock_batch(
  p_store_id UUID,
  p_items JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_store_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN 0;
  END IF;

  -- Two levels on purpose. Batching changes the blast radius of a bad row:
  -- the per-line loop this replaces lost only the line whose product_id would
  -- not cast to UUID, because each call failed on its own. Here one malformed
  -- id would abort the whole statement and silently decrement NOTHING for the
  -- sale. So candidates are filtered as TEXT first and only cast after the
  -- GROUP BY, which is an aggregation boundary — nothing reaches the cast that
  -- did not pass the scan qual.
  WITH candidate AS (
    SELECT
      elem ->> 'product_id'          AS id_text,
      (elem ->> 'quantity')::NUMERIC AS quantity
    FROM jsonb_array_elements(p_items) AS elem
    WHERE jsonb_typeof(elem -> 'quantity') = 'number'
      AND elem ->> 'product_id' ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  wanted AS (
    SELECT id_text::UUID AS product_id, SUM(quantity) AS quantity
    FROM candidate
    GROUP BY id_text
  ),
  applied AS (
    UPDATE products p
       SET stock_quantity = p.stock_quantity - ROUND(w.quantity)::INTEGER
      FROM wanted w
     WHERE p.id = w.product_id
       AND p.store_id = p_store_id
    RETURNING p.id
  )
  SELECT COUNT(*) INTO v_updated FROM applied;

  RETURN v_updated;
END;
$fn$;

GRANT EXECUTE ON FUNCTION decrement_stock_batch(UUID, JSONB) TO service_role;

-- While we are here: decrement_stock is SECURITY DEFINER with no search_path,
-- which is a privilege-escalation hole (audit P0-5). Re-declaring the body
-- unchanged and adding the setting — this does not alter its behaviour.
CREATE OR REPLACE FUNCTION decrement_stock(
  product_id UUID,
  quantity INTEGER,
  p_store_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_store_id IS NOT NULL THEN
    UPDATE products
       SET stock_quantity = stock_quantity - quantity
     WHERE id = product_id
       AND store_id = p_store_id;
  ELSE
    UPDATE products
       SET stock_quantity = stock_quantity - quantity
     WHERE id = product_id;
  END IF;
END;
$fn$;


-- =============================================================================
-- 3. get_transaction_analytics — the report, aggregated in Postgres
--
-- GET /api/transactions/analytics fetched EVERY transaction in the window with
-- EVERY nested line item and aggregated the lot in JavaScript, with no limit.
-- That was two separate problems:
--
--   * SLOW: 700-2,900 ms measured on a store with FORTY sales, to return 3 KB.
--   * WRONG: PostgREST silently caps an unbounded select at 1,000 rows, so any
--     store with more than 1,000 sales in the window was shown revenue and
--     profit computed from an arbitrary 1,000 of them, with nothing on screen
--     to say so. The rule that produced `get_shift_totals` and
--     `get_unassigned_totals` applies here too (CLAUDE.md §11a): aggregate in
--     Postgres, never by summing a select.
--
-- ## The exchange rate stays in format.ts
--
-- `cost_price` is stored in the product's OWN currency, and a USD cost must be
-- converted before it is subtracted from LL revenue. This function does NOT do
-- that conversion — the rate has exactly one definition, in
-- src/lib/utils/format.ts, and duplicating it in SQL is how this codebase ended
-- up with four disagreeing LL/USD conversions (audit P1-6).
--
-- So the cost comes back in two pieces:
--   `cost_ll`        — already-LL costs, summed. Includes the fallback lines.
--   `usd_cost_lines` — one row per distinct USD cost_price, with the total
--                      quantity sold at it. The caller converts each with
--                      convertUsdToLl() and multiplies, which is exactly what
--                      productCostInLL() did per product before. Converting a
--                      pre-summed USD total instead would round once instead of
--                      per product and quietly move the figure.
--
-- The "unknown product => cost = unit_price" fallback from
-- src/lib/analytics/profit.ts is reproduced verbatim: it books an unpriceable
-- line at zero profit rather than counting its full revenue as profit.
--
-- `total_items_sold` counts LINES, not units. That is what the JS did and what
-- the card on screen means by it; changing it here would silently move a number
-- the owner reads every day.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_transaction_analytics(
  p_store_id UUID,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_tz TEXT DEFAULT 'Asia/Beirut'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tz     TEXT := COALESCE(NULLIF(p_tz, ''), 'Asia/Beirut');
  v_result JSONB;
BEGIN
  -- An unknown zone name would abort the whole report; fall back to the shop's.
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'Asia/Beirut';
  END;

  WITH txn AS (
    SELECT t.id, t.total_amount, t.created_at
      FROM transactions t
     WHERE t.store_id = p_store_id
       AND (p_from IS NULL OR t.created_at >= p_from)
  ),
  line AS (
    SELECT
      ti.product_name,
      ti.quantity,
      ti.unit_price,
      ti.total_price,
      pr.cost_price,
      pr.currency AS cost_currency
      FROM transaction_items ti
      JOIN txn                ON txn.id = ti.transaction_id
      -- LEFT: a deleted product leaves product_id NULL (migration 028) and a
      -- one-off line never had one. Both take the unit_price fallback below.
      LEFT JOIN products pr   ON pr.id = ti.product_id
                             AND pr.store_id = p_store_id
  ),
  summary AS (
    SELECT
      COALESCE(SUM(total_amount), 0)::NUMERIC AS total_revenue,
      COUNT(*)::BIGINT                        AS total_transactions
      FROM txn
  ),
  line_totals AS (
    SELECT
      COUNT(*)::BIGINT AS total_items_sold,
      -- LL costs, plus the unknown-product fallback, which is already LL.
      COALESCE(SUM(
        CASE
          WHEN cost_price IS NULL    THEN COALESCE(unit_price, 0) * quantity
          WHEN cost_currency = 'USD' THEN 0
          ELSE COALESCE(cost_price, 0) * quantity
        END
      ), 0)::NUMERIC AS cost_ll
      FROM line
  ),
  usd_costs AS (
    SELECT cost_price, SUM(quantity)::NUMERIC AS quantity
      FROM line
     WHERE cost_price IS NOT NULL
       AND cost_currency = 'USD'
     GROUP BY cost_price
  ),
  product_stats AS (
    SELECT
      product_name,
      SUM(quantity)::NUMERIC                 AS total_quantity,
      COALESCE(SUM(total_price), 0)::NUMERIC AS total_revenue
      FROM line
     GROUP BY product_name
  ),
  hours AS (
    SELECT
      h.hour,
      COALESCE(SUM(txn.total_amount), 0)::NUMERIC AS revenue,
      COUNT(txn.id)::BIGINT                       AS transactions
      FROM generate_series(0, 23) AS h(hour)
      LEFT JOIN txn
             ON EXTRACT(HOUR FROM (txn.created_at AT TIME ZONE v_tz))::INT = h.hour
     GROUP BY h.hour
  ),
  weekdays AS (
    SELECT
      d.dow,
      COALESCE(SUM(txn.total_amount), 0)::NUMERIC AS revenue,
      COUNT(txn.id)::BIGINT                       AS transactions
      FROM generate_series(0, 6) AS d(dow)
      LEFT JOIN txn
             ON EXTRACT(DOW FROM (txn.created_at AT TIME ZONE v_tz))::INT = d.dow
     GROUP BY d.dow
  )
  SELECT jsonb_build_object(
    'total_revenue',      (SELECT total_revenue FROM summary),
    'total_transactions', (SELECT total_transactions FROM summary),
    'total_items_sold',   (SELECT total_items_sold FROM line_totals),
    'cost_ll',            (SELECT cost_ll FROM line_totals),
    'usd_cost_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('cost_price', cost_price, 'quantity', quantity))
        FROM usd_costs
    ), '[]'::jsonb),
    'top_by_revenue', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'product_name', product_name,
               'totalQuantity', total_quantity,
               'totalRevenue', total_revenue))
        FROM (SELECT * FROM product_stats ORDER BY total_revenue DESC LIMIT 10) r
    ), '[]'::jsonb),
    'top_by_quantity', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'product_name', product_name,
               'totalQuantity', total_quantity,
               'totalRevenue', total_revenue))
        FROM (SELECT * FROM product_stats ORDER BY total_quantity DESC LIMIT 10) q
    ), '[]'::jsonb),
    'hourly', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'hour', hour, 'revenue', revenue, 'transactions', transactions)
             ORDER BY hour)
        FROM hours
    ), '[]'::jsonb),
    'weekday', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'dow', dow, 'revenue', revenue, 'transactions', transactions)
             ORDER BY dow)
        FROM weekdays
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$fn$;

GRANT EXECUTE ON FUNCTION get_transaction_analytics(UUID, TIMESTAMPTZ, TEXT) TO service_role;


-- =============================================================================
-- 4. Drop duplicate indexes on `transactions`
--
-- Every index on a table is written on every INSERT, so a duplicate is a pure
-- tax on the checkout path. `transactions` had accumulated THREE identical
-- copies of (store_id, created_at DESC) across migrations 003, 014 and 019,
-- plus two strict prefixes of indexes that already exist.
--
-- What is kept, and why nothing loses its index:
--   idx_transactions_store_created_at   (store_id, created_at DESC) — the one
--       every history/analytics/cash query actually uses. A scan on store_id
--       alone uses it too (leading column), so idx_transactions_store adds
--       nothing.
--   idx_transactions_created_at_desc    (created_at DESC) — cross-store sweeps
--       (scheduled_transaction_cleanup). Postgres walks a btree in either
--       direction, so the separate ASC copy answers nothing this does not.
--
-- IF EXISTS throughout: this repo is not a reliable description of production
-- (see .claude/skills/db-migration), so some of these may not be there at all.
-- =============================================================================

DROP INDEX IF EXISTS idx_transactions_store_date;      -- 014, dup of 003
DROP INDEX IF EXISTS idx_transactions_store_created;   -- 019, dup of 003
DROP INDEX IF EXISTS idx_transactions_store;           -- 001, prefix of 003
DROP INDEX IF EXISTS idx_transactions_created;         -- 001, dup of 003 DESC

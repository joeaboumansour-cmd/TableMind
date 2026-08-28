-- ============================================================================
-- 027 — Multi-register cash management
-- ============================================================================
-- Turns the cash drawer from "one per store per day" into "N named registers,
-- each with its own shift lifecycle".
--
-- The central change is that a shift's identity stops being the calendar date.
-- Before this migration `cash_shifts` carried UNIQUE(store_id, business_date),
-- so a shift WAS a day. At midnight the client asked for the new date, got
-- nothing back, and rendered "No Shift Open" while yesterday's row was still
-- status='open' — orphaned, not closed, with its cash never reconciled and its
-- post-midnight sales attributed to a shift that did not exist yet.
--
-- After this migration a shift lives opened_at -> closed_at, transactions carry
-- the shift they were rung on, and "one open shift per register" is enforced by
-- a partial unique index that has no time horizon (the old guard in the API
-- only ever looked back exactly one day).
--
-- Written defensively (IF NOT EXISTS / catalog lookups) because the repo's
-- migration files are NOT a reliable description of the deployed database.
-- ============================================================================


-- ============================================================================
-- CASH REGISTERS — durable, named, one row per physical drawer
-- ============================================================================

CREATE TABLE IF NOT EXISTS cash_registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES store_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_registers_store
  ON cash_registers(store_id, sort_order, created_at);

-- Two LIVE registers may not share a name (case-insensitively). Deactivated
-- ones are excluded so a name can be retired and reused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_registers_unique_name
  ON cash_registers(store_id, lower(name)) WHERE is_active;


-- ============================================================================
-- CASH SHIFTS — add the register link, drop the date as identity
-- ============================================================================

ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS register_id UUID
  REFERENCES cash_registers(id) ON DELETE RESTRICT;

-- Optional free-text note for one shift, e.g. "Morning rush". The durable
-- name lives on the register; this is per-occurrence colour only.
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS label TEXT;

-- ---------------------------------------------------------------------------
-- WHO IS ON THIS DRAWER
-- ---------------------------------------------------------------------------
-- The supervisor opens a shift on a register and names the cashier working it.
-- Everything that cashier then sells is attributed to this shift, and through
-- it to this register.
--
-- This is what makes a multi-register shop workable. The alternative — each
-- till remembering which drawer it is — cannot be administered: the setting
-- would live in each till's own browser storage, so a supervisor could not set
-- it from their own machine, and a cashier with POS-only permission cannot
-- reach the cash page to set it themselves.
--
-- Assignment is expressed with TWO columns, not one nullable id, because a
-- single nullable column would have to mean both "the owner is on this drawer"
-- and "nobody is on it yet" — and those must be told apart. The supervisor
-- legitimately opens several drawers before naming anyone on them.
--
--   assigned_user_id set        -> that employee
--   assigned_to_owner = true    -> the store owner (who has no store_users row,
--                                  so their id cannot live in an FK column)
--   neither                     -> not yet assigned; sales stay unassigned
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS assigned_user_id UUID
  REFERENCES store_users(id) ON DELETE SET NULL;

ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS assigned_to_owner BOOLEAN
  NOT NULL DEFAULT false;

-- Denormalised so a shift still reads correctly after an employee is deleted.
-- The counted history of a drawer must not lose the name of who was on it.
ALTER TABLE cash_shifts ADD COLUMN IF NOT EXISTS assigned_user_name TEXT;

-- ---------------------------------------------------------------------------
-- Backfill: give every store that already has shifts a "Main Register", and
-- point its existing shifts at it. Idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO cash_registers (store_id, name, sort_order)
SELECT DISTINCT s.store_id, 'Main Register', 0
FROM cash_shifts s
WHERE NOT EXISTS (
  SELECT 1 FROM cash_registers r
  WHERE r.store_id = s.store_id AND lower(r.name) = 'main register'
);

UPDATE cash_shifts s
SET register_id = r.id
FROM cash_registers r
WHERE s.register_id IS NULL
  AND r.store_id = s.store_id
  AND lower(r.name) = 'main register';

-- ---------------------------------------------------------------------------
-- Collapse any pre-existing multiple-open-shifts-per-register situation before
-- adding the unique index, otherwise index creation fails on live data.
--
-- This does NOT close anything and does NOT invent a count. It leaves the most
-- recently opened shift on each register open, and moves the older ones onto
-- their own register named after the day they were opened, so the money stays
-- visible and countable. A shift is never closed by a machine.
-- ---------------------------------------------------------------------------
DO $migrate$
DECLARE
  dup RECORD;
  new_register UUID;
  reg_name TEXT;
BEGIN
  FOR dup IN
    SELECT id, store_id, business_date
    FROM (
      SELECT id, store_id, business_date,
             ROW_NUMBER() OVER (PARTITION BY register_id ORDER BY opened_at DESC) AS rn
      FROM cash_shifts
      WHERE status = 'open' AND register_id IS NOT NULL
    ) ranked
    WHERE rn > 1
  LOOP
    reg_name := 'Uncounted ' || dup.business_date::text;

    INSERT INTO cash_registers (store_id, name, sort_order, is_active)
    VALUES (dup.store_id, reg_name, 100, true)
    ON CONFLICT DO NOTHING;

    SELECT id INTO new_register FROM cash_registers
    WHERE store_id = dup.store_id AND lower(name) = lower(reg_name)
    LIMIT 1;

    IF new_register IS NOT NULL THEN
      UPDATE cash_shifts SET register_id = new_register WHERE id = dup.id;
    END IF;
  END LOOP;
END
$migrate$;

-- Every shift now belongs to a register.
ALTER TABLE cash_shifts ALTER COLUMN register_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_shifts_register
  ON cash_shifts(register_id, opened_at DESC);

-- ---------------------------------------------------------------------------
-- Drop UNIQUE(store_id, business_date). This is the change that unblocks
-- everything: it is what made a shift and a calendar day the same object.
-- Located through the catalog rather than by name, because the constraint was
-- declared inline in 021 and its generated name is not guaranteed.
-- ---------------------------------------------------------------------------
DO $dropuniq$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'cash_shifts'::regclass
    AND c.contype = 'u'
    AND (
      SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM unnest(c.conkey) k
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
    ) = ARRAY['business_date', 'store_id']
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cash_shifts DROP CONSTRAINT %I', con_name);
  END IF;
END
$dropuniq$;

-- The real guard, replacing both the old unique constraint and the
-- "was yesterday's shift left open?" lookback in the API. A register may have
-- at most one open shift, no matter how long ago it was opened.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_register
  ON cash_shifts(register_id) WHERE status = 'open';

-- A cashier may be on at most one drawer at a time. Without this a sale could
-- match two open shifts and attribution would be a coin toss.
--
-- Two indexes rather than one, and both carry IS NOT NULL / = true in the
-- predicate. A unique index treats NULLs as distinct, so a single index over a
-- nullable column would silently permit exactly the duplicates it looks like it
-- prevents, while still allowing the several genuinely-unassigned open shifts a
-- supervisor creates before naming anyone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_user
  ON cash_shifts(assigned_user_id)
  WHERE status = 'open' AND assigned_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_for_owner
  ON cash_shifts(store_id)
  WHERE status = 'open' AND assigned_to_owner;

-- Resolving a sale means "which shift was this cashier on when they rang it",
-- so that lookup rides on assigned_user_id + the time window.
CREATE INDEX IF NOT EXISTS idx_cash_shifts_assigned_open
  ON cash_shifts(store_id, assigned_user_id, opened_at DESC);


-- ============================================================================
-- TRANSACTIONS — which drawer did this sale go into
-- ============================================================================
-- Both nullable. A sale is NEVER blocked or failed by cash-register state, so
-- "no register configured on this device" and "no shift open" both have to be
-- representable. Those land in the Unassigned bucket on the cash page.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS shift_id UUID
  REFERENCES cash_shifts(id) ON DELETE SET NULL;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS register_id UUID
  REFERENCES cash_registers(id) ON DELETE SET NULL;

-- Reconciliation reads sales by shift, so this is on the hot path of the cash
-- page. Partial: only assigned rows are ever looked up this way.
CREATE INDEX IF NOT EXISTS idx_transactions_shift
  ON transactions(shift_id) WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_store_register
  ON transactions(store_id, register_id, created_at DESC);


-- ============================================================================
-- REGISTER REQUESTS — a cashier asking the responsible person for a privilege
-- ============================================================================
-- Built now, populated by the later "cashier requests a refund of a sold item"
-- feature. The cash page renders a live (empty) panel against it.
--
-- Note the asymmetry with shifts: a request MAY expire on its own, because
-- expiry withholds a permission and withholding is the safe direction. A shift
-- may not, because auto-closing fabricates a money figure nobody counted.

CREATE TABLE IF NOT EXISTS register_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  register_id UUID NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES cash_shifts(id) ON DELETE SET NULL,

  -- Closed vocabulary, mirrored in src/lib/cash/types.ts.
  kind TEXT NOT NULL CHECK (kind IN (
    'refund_sold_item',
    'price_override',
    'void_line',
    'discount_override',
    'cash_out'
  )),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'expired', 'cancelled'
  )),

  requested_by UUID REFERENCES store_users(id) ON DELETE SET NULL,
  requested_by_name TEXT NOT NULL DEFAULT '',
  reason TEXT,

  -- What is being asked for: transaction number, line, amount, and so on.
  -- Deliberately loose — the shape differs per kind and the deciding UI only
  -- ever displays it.
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  decided_by UUID REFERENCES store_users(id) ON DELETE SET NULL,
  decided_by_name TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,

  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The cash page polls for pending requests every few seconds; this is the
-- index that query rides on.
CREATE INDEX IF NOT EXISTS idx_register_requests_pending
  ON register_requests(store_id, created_at DESC) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_register_requests_register
  ON register_requests(register_id, created_at DESC);


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- RLS enabled with NO permissive policies. The service role bypasses RLS, and
-- every read/write path for these tables goes through an API route using
-- createServiceRoleClient. This deliberately does NOT copy the USING (true)
-- pattern from 021 — that grants full read and write to anyone holding the
-- public anon key, which is audit finding P0-5.

ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_requests ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- DEAD CODE REMOVAL
-- ============================================================================
-- get_cash_shift_summary() aggregated by created_at::date, which is exactly the
-- behaviour this migration exists to replace, and nothing under src/ has ever
-- called it — the GET route re-implements the aggregation in TypeScript.
-- Leaving it behind would leave a second, wrong definition of the drawer maths
-- in the database for someone to find later and trust.

DROP FUNCTION IF EXISTS get_cash_shift_summary(UUID);


-- ============================================================================
-- SHIFT TOTALS — aggregate sales per shift, server side
-- ============================================================================
-- Deliberately an RPC rather than a select the route sums in JavaScript.
-- PostgREST silently caps an unbounded select at 1000 rows, so a shift with
-- more than 1000 sales would have reconciled against a truncated list and
-- reported a drawer short by everything past row 1000 — the same class of trap
-- documented for reconcileProductsCache() in CLAUDE.md.
--
-- Returns GROSS figures. The caller subtracts change to get what stayed in the
-- drawer, and must NOT add usd_amount_paid back into the LL total: those
-- dollars are already inside amount_paid, converted at RETURN_RATE by checkout.
-- Adding both is audit finding P1-2. usd_amount_paid is returned for display
-- only.

CREATE OR REPLACE FUNCTION get_shift_totals(p_store_id UUID, p_shift_ids UUID[])
RETURNS TABLE (
  shift_id UUID,
  amount_paid DECIMAL(14,2),
  change_given DECIMAL(14,2),
  usd_amount_paid DECIMAL(14,2),
  txn_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- p_store_id has no default and is always applied. A tenant-scoping argument
  -- that can be skipped is how decrement_stock became audit P0-5.
  RETURN QUERY
  SELECT
    t.shift_id,
    COALESCE(SUM(t.amount_paid), 0)::DECIMAL(14,2),
    COALESCE(SUM(t.change_given), 0)::DECIMAL(14,2),
    COALESCE(SUM(t.usd_amount_paid), 0)::DECIMAL(14,2),
    COUNT(*)::BIGINT
  FROM transactions t
  WHERE t.store_id = p_store_id
    AND t.shift_id = ANY(p_shift_ids)
  GROUP BY t.shift_id;
END
$fn$;

REVOKE ALL ON FUNCTION get_shift_totals(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_shift_totals(UUID, UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION get_shift_totals(UUID, UUID[]) TO service_role;


-- ============================================================================
-- REGISTER PERFORMANCE — which drawer is carrying the shop
-- ============================================================================
-- Per-register metrics over a date range, aggregated in Postgres for the same
-- reason get_shift_totals is: a JS sum over a select would silently stop at
-- PostgREST's 1000-row cap and under-report the busiest register, which is
-- exactly the register this report exists to identify.
--
-- Revenue is NET cash into the drawer (amount_paid - change_given). It is not
-- SUM(total_amount): a register's takings are what stayed in it. USD is not
-- added separately — those dollars are already inside amount_paid (audit P1-2).

CREATE OR REPLACE FUNCTION get_register_performance(
  p_store_id UUID,
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE (
  register_id UUID,
  register_name TEXT,
  revenue DECIMAL(14,2),
  txn_count BIGINT,
  avg_basket DECIMAL(14,2),
  largest_sale DECIMAL(14,2),
  active_days BIGINT,
  peak_hour INTEGER,
  peak_hour_txns BIGINT,
  shifts_closed BIGINT,
  hours_open NUMERIC,
  -- Raw variance COMPONENTS, not a variance.
  --
  -- Reconciling a drawer needs LL and USD combined at an exchange rate, and
  -- that rate lives in src/lib/utils/format.ts, which CLAUDE.md makes the
  -- single source of truth for it. Hardcoding 90,000 here would create a
  -- second copy that silently disagrees the day the rate moves. So the pieces
  -- come back raw and combineCurrencyTotals() puts them together in TS.
  opening_ll DECIMAL(14,2),
  opening_usd DECIMAL(14,2),
  closing_ll DECIMAL(14,2),
  closing_usd DECIMAL(14,2),
  closed_shift_sales DECIMAL(14,2),
  adj_in_ll DECIMAL(14,2),
  adj_in_usd DECIMAL(14,2),
  adj_out_ll DECIMAL(14,2),
  adj_out_usd DECIMAL(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $perf$
BEGIN
  RETURN QUERY
  WITH sales AS (
    SELECT
      t.register_id AS reg,
      t.shift_id,
      (COALESCE(t.amount_paid, 0) - COALESCE(t.change_given, 0)) AS net,
      t.created_at
    FROM transactions t
    WHERE t.store_id = p_store_id
      AND t.register_id IS NOT NULL
      AND t.created_at >= p_from
      AND t.created_at < p_to
  ),
  agg AS (
    SELECT
      s.reg,
      COALESCE(SUM(s.net), 0)::DECIMAL(14,2) AS revenue,
      COUNT(*)::BIGINT AS txn_count,
      COALESCE(AVG(s.net), 0)::DECIMAL(14,2) AS avg_basket,
      COALESCE(MAX(s.net), 0)::DECIMAL(14,2) AS largest_sale,
      COUNT(DISTINCT s.created_at::date)::BIGINT AS active_days
    FROM sales s
    GROUP BY s.reg
  ),
  peak AS (
    SELECT DISTINCT ON (s.reg)
      s.reg,
      EXTRACT(HOUR FROM s.created_at)::INTEGER AS hr,
      COUNT(*)::BIGINT AS hr_count
    FROM sales s
    GROUP BY s.reg, EXTRACT(HOUR FROM s.created_at)
    ORDER BY s.reg, COUNT(*) DESC, EXTRACT(HOUR FROM s.created_at)
  ),
  -- Only CLOSED shifts carry a counted figure, so only those can be
  -- reconciled. An open shift is not "balanced" — it is simply unknown.
  closed_shifts AS (
    SELECT cs.id, cs.register_id AS reg,
           cs.opening_ll, cs.opening_usd, cs.closing_ll, cs.closing_usd,
           EXTRACT(EPOCH FROM (cs.closed_at - cs.opened_at)) / 3600.0 AS hrs
    FROM cash_shifts cs
    WHERE cs.store_id = p_store_id
      AND cs.status = 'closed'
      AND cs.closed_at >= p_from
      AND cs.closed_at < p_to
  ),
  shift_agg AS (
    SELECT
      c.reg,
      COUNT(*)::BIGINT AS shifts_closed,
      COALESCE(SUM(c.hrs), 0)::NUMERIC AS hours_open,
      COALESCE(SUM(c.opening_ll), 0)::DECIMAL(14,2) AS opening_ll,
      COALESCE(SUM(c.opening_usd), 0)::DECIMAL(14,2) AS opening_usd,
      COALESCE(SUM(c.closing_ll), 0)::DECIMAL(14,2) AS closing_ll,
      COALESCE(SUM(c.closing_usd), 0)::DECIMAL(14,2) AS closing_usd,
      -- Sales belonging to those same closed shifts, so the variance compares
      -- like with like. Scoped to the shift, not to the date window, which is
      -- the whole point of stamping shift_id onto transactions.
      -- Deliberately NOT sourced from `sales` above: that CTE is clipped to the
      -- report window, and a shift's variance has to compare its counted cash
      -- against ALL of its own sales. A shift opened the evening before the
      -- window starts would otherwise look short by its first hours' takings.
      COALESCE((
        SELECT SUM(COALESCE(t2.amount_paid, 0) - COALESCE(t2.change_given, 0))
        FROM transactions t2
        WHERE t2.store_id = p_store_id
          AND t2.shift_id IN (SELECT c2.id FROM closed_shifts c2 WHERE c2.reg = c.reg)
      ), 0)::DECIMAL(14,2) AS shift_sales
    FROM closed_shifts c
    GROUP BY c.reg
  ),
  adj_agg AS (
    SELECT
      cs.reg,
      COALESCE(SUM(a.amount_ll) FILTER (WHERE a.adjustment_type = 'cash_in'), 0)::DECIMAL(14,2) AS in_ll,
      COALESCE(SUM(a.amount_usd) FILTER (WHERE a.adjustment_type = 'cash_in'), 0)::DECIMAL(14,2) AS in_usd,
      COALESCE(SUM(a.amount_ll) FILTER (WHERE a.adjustment_type = 'cash_out'), 0)::DECIMAL(14,2) AS out_ll,
      COALESCE(SUM(a.amount_usd) FILTER (WHERE a.adjustment_type = 'cash_out'), 0)::DECIMAL(14,2) AS out_usd
    FROM cash_adjustments a
    JOIN closed_shifts cs ON cs.id = a.shift_id
    WHERE a.store_id = p_store_id
    GROUP BY cs.reg
  )
  SELECT
    r.id,
    r.name,
    COALESCE(agg.revenue, 0)::DECIMAL(14,2),
    COALESCE(agg.txn_count, 0)::BIGINT,
    COALESCE(agg.avg_basket, 0)::DECIMAL(14,2),
    COALESCE(agg.largest_sale, 0)::DECIMAL(14,2),
    COALESCE(agg.active_days, 0)::BIGINT,
    peak.hr,
    COALESCE(peak.hr_count, 0)::BIGINT,
    COALESCE(shift_agg.shifts_closed, 0)::BIGINT,
    COALESCE(shift_agg.hours_open, 0)::NUMERIC,
    COALESCE(shift_agg.opening_ll, 0)::DECIMAL(14,2),
    COALESCE(shift_agg.opening_usd, 0)::DECIMAL(14,2),
    COALESCE(shift_agg.closing_ll, 0)::DECIMAL(14,2),
    COALESCE(shift_agg.closing_usd, 0)::DECIMAL(14,2),
    COALESCE(shift_agg.shift_sales, 0)::DECIMAL(14,2),
    COALESCE(adj_agg.in_ll, 0)::DECIMAL(14,2),
    COALESCE(adj_agg.in_usd, 0)::DECIMAL(14,2),
    COALESCE(adj_agg.out_ll, 0)::DECIMAL(14,2),
    COALESCE(adj_agg.out_usd, 0)::DECIMAL(14,2)
  FROM cash_registers r
  LEFT JOIN agg ON agg.reg = r.id
  LEFT JOIN peak ON peak.reg = r.id
  LEFT JOIN shift_agg ON shift_agg.reg = r.id
  LEFT JOIN adj_agg ON adj_agg.reg = r.id
  WHERE r.store_id = p_store_id
    AND r.is_active
  ORDER BY COALESCE(agg.revenue, 0) DESC;
END
$perf$;

REVOKE ALL ON FUNCTION get_register_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_register_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION get_register_performance(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

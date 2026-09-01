-- ============================================================================
-- 039 — CASH OVERVIEW: the cash page's three round trips become one
-- ============================================================================
-- `GET /api/cash-shifts` was measured at **849 ms** (2026-09-01), against the
-- ~300 ms single-round-trip floor the rest of the API now sits at. It was not
-- slow code — it was three waves that genuinely depend on each other:
--
--   1. the store's active registers
--   2. the shifts on those registers          (needs the register ids)
--   3. the sales totals for those shifts      (needs the shift ids)
--
-- Latency paid three times over. Postgres already has all three in one place,
-- so this does the whole traversal server-side and returns it in one payload.
--
-- ## The selection rule, moved rather than duplicated
--
-- The TypeScript rule was: take every OPEN shift, plus the most recent CLOSED
-- shift for any register without an open one. `DISTINCT ON (register_id)`
-- ordered by "open first, then most recently closed" is exactly that, and it
-- fixes a latent bug on the way:
--
--   The old code fetched closed shifts with `.limit(registerIds.length * 3)`.
--   That is a FETCH bound, not a semantic one — if three-times-the-register-
--   count of more recent closed shifts all belonged to other registers, a
--   register's own last shift fell outside the window and its card showed no
--   figures at all. Rare, silent, and only on stores with many registers.
--   DISTINCT ON has no window to fall outside of.
--
-- ## What this does NOT do
--
-- No money is converted here. `usd_amount_paid` comes back as its own
-- component exactly as `get_shift_totals` returns it, because the LL/USD rate
-- has one definition, in src/lib/utils/format.ts, and duplicating it in SQL is
-- how this codebase ended up with four disagreeing conversions (audit P1-6).
-- `summariseShift()` still does the arithmetic.
--
-- Employees, pending requests and the unassigned totals are deliberately NOT
-- folded in. They do not depend on the registers, so they already run in
-- parallel with wave 1 and cost nothing; pulling them in here would make one
-- function responsible for the whole screen and harder to reason about.
--
-- ## Safety
--
-- `p_store_id` has no default and is applied to every table touched. A
-- tenant-scoping argument that can be skipped is how `decrement_stock` became
-- audit P0-5. Granted to `service_role` only — the API routes are the only
-- caller and they already resolve the caller before returning anything.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_cash_overview(
  p_store_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result JSONB;
BEGIN
  WITH active_registers AS (
    SELECT r.*
    FROM cash_registers r
    WHERE r.store_id = p_store_id
      AND r.is_active = TRUE
    ORDER BY r.sort_order ASC, r.created_at ASC
  ),
  -- One shift per register: the open one, or failing that the most recently
  -- closed one. See the note above on why this replaces a LIMIT.
  current_shifts AS (
    SELECT DISTINCT ON (s.register_id) s.*
    FROM cash_shifts s
    JOIN active_registers r ON r.id = s.register_id
    WHERE s.store_id = p_store_id
    ORDER BY
      s.register_id,
      (s.status = 'open') DESC,
      s.closed_at DESC NULLS LAST,
      s.opened_at DESC
  ),
  -- Aggregated in Postgres, never by summing a select: a JS sum would stop at
  -- PostgREST's 1000-row cap and under-report exactly the busiest shift.
  shift_totals AS (
    SELECT
      t.shift_id,
      COALESCE(SUM(t.amount_paid), 0)::DECIMAL(14,2)      AS amount_paid,
      COALESCE(SUM(t.change_given), 0)::DECIMAL(14,2)     AS change_given,
      COALESCE(SUM(t.usd_amount_paid), 0)::DECIMAL(14,2)  AS usd_amount_paid,
      COUNT(*)::BIGINT                                    AS txn_count
    FROM transactions t
    WHERE t.store_id = p_store_id
      AND t.shift_id IN (SELECT cs.id FROM current_shifts cs)
    GROUP BY t.shift_id
  ),
  shift_adjustments AS (
    SELECT a.*
    FROM cash_adjustments a
    WHERE a.store_id = p_store_id
      AND a.shift_id IN (SELECT cs.id FROM current_shifts cs)
    ORDER BY a.created_at ASC
  )
  SELECT jsonb_build_object(
    'registers',
      COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sort_order ASC, r.created_at ASC)
                FROM active_registers r), '[]'::jsonb),
    'shifts',
      COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM current_shifts s), '[]'::jsonb),
    -- Keyed by shift id, which is the shape the route already builds by hand.
    'totals',
      COALESCE((SELECT jsonb_object_agg(st.shift_id::text, to_jsonb(st))
                FROM shift_totals st), '{}'::jsonb),
    'adjustments',
      COALESCE((SELECT jsonb_object_agg(grouped.shift_id::text, grouped.rows)
                FROM (
                  SELECT a.shift_id,
                         jsonb_agg(to_jsonb(a) ORDER BY a.created_at ASC) AS rows
                  FROM shift_adjustments a
                  GROUP BY a.shift_id
                ) grouped), '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END
$fn$;

REVOKE ALL ON FUNCTION get_cash_overview(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_cash_overview(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_cash_overview(UUID) TO service_role;

-- The shift lookup is per register and ordered; without this it is a scan of
-- the store's whole shift history on every cash-page load.
CREATE INDEX IF NOT EXISTS idx_cash_shifts_register_current
  ON cash_shifts (store_id, register_id, status, closed_at DESC);

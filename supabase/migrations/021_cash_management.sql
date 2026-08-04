-- Cash Register Management
-- Daily cash shift tracking: opening float, sales cash in/out, closing count
-- Owner-controlled: employees cannot set opening or closing amounts

-- ============================================================================
-- CASH SHIFTS TABLE
-- ============================================================================

CREATE TABLE cash_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by UUID REFERENCES store_users(id) ON DELETE SET NULL,
  opened_by_name TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opening_ll DECIMAL(12,2) NOT NULL DEFAULT 0,
  opening_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  closed_by UUID REFERENCES store_users(id) ON DELETE SET NULL,
  closed_by_name TEXT,
  closed_at TIMESTAMPTZ,
  closing_ll DECIMAL(12,2),
  closing_usd DECIMAL(12,2),
  verified BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, business_date)
);

CREATE INDEX idx_cash_shifts_store_date ON cash_shifts(store_id, business_date DESC);
CREATE INDEX idx_cash_shifts_store_status ON cash_shifts(store_id, status);

-- ============================================================================
-- CASH ADJUSTMENTS TABLE (owner-only mid-day cash in/out)
-- ============================================================================

CREATE TABLE cash_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('cash_in', 'cash_out')),
  amount_ll DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  created_by UUID REFERENCES store_users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_adjustments_shift ON cash_adjustments(shift_id);
CREATE INDEX idx_cash_adjustments_store ON cash_adjustments(store_id);

-- ============================================================================
-- ROW LEVEL SECURITY (follows existing permissive pattern)
-- ============================================================================

ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_shifts_select" ON cash_shifts FOR SELECT USING (true);
CREATE POLICY "cash_shifts_insert" ON cash_shifts FOR INSERT WITH CHECK (true);
CREATE POLICY "cash_shifts_update" ON cash_shifts FOR UPDATE USING (true);
CREATE POLICY "cash_shifts_delete" ON cash_shifts FOR DELETE USING (true);

CREATE POLICY "cash_adjustments_select" ON cash_adjustments FOR SELECT USING (true);
CREATE POLICY "cash_adjustments_insert" ON cash_adjustments FOR INSERT WITH CHECK (true);
CREATE POLICY "cash_adjustments_update" ON cash_adjustments FOR UPDATE USING (true);
CREATE POLICY "cash_adjustments_delete" ON cash_adjustments FOR DELETE USING (true);

-- ============================================================================
-- HELPER FUNCTION: Compute expected drawer totals for a shift
-- ============================================================================

CREATE OR REPLACE FUNCTION get_cash_shift_summary(p_shift_id UUID)
RETURNS TABLE (
  store_id UUID, business_date DATE, status TEXT,
  opening_ll DECIMAL(12,2), opening_usd DECIMAL(12,2),
  closing_ll DECIMAL(12,2), closing_usd DECIMAL(12,2),
  verified BOOLEAN,
  total_sold DECIMAL(12,2), total_cash_in DECIMAL(12,2), total_change DECIMAL(12,2),
  adjustments_in DECIMAL(12,2), adjustments_out DECIMAL(12,2),
  expected_ll DECIMAL(12,2), expected_usd DECIMAL(12,2),
  variance_ll DECIMAL(12,2), variance_usd DECIMAL(12,2),
  transaction_count BIGINT
) AS $$
DECLARE
  v_store_id UUID; v_business_date DATE; v_status TEXT;
  v_opening_ll DECIMAL(12,2); v_opening_usd DECIMAL(12,2);
  v_closing_ll DECIMAL(12,2); v_closing_usd DECIMAL(12,2); v_verified BOOLEAN;
BEGIN
  SELECT store_id, business_date, status, opening_ll, opening_usd, closing_ll, closing_usd, verified
  INTO v_store_id, v_business_date, v_status, v_opening_ll, v_opening_usd, v_closing_ll, v_closing_usd, v_verified
  FROM cash_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH txn_agg AS (
    SELECT
      COALESCE(SUM(total_amount),0)::DECIMAL(12,2) AS sold,
      COALESCE(SUM(amount_paid),0)::DECIMAL(12,2) AS cash_in,
      COALESCE(SUM(change_given),0)::DECIMAL(12,2) AS chg,
      COALESCE(SUM(usd_amount_paid),0)::DECIMAL(12,2) AS cash_in_usd,
      COALESCE(SUM(usd_change_given),0)::DECIMAL(12,2) AS chg_usd,
      COUNT(*)::BIGINT AS cnt
    FROM transactions
    WHERE store_id = v_store_id AND created_at::date = v_business_date
  ),
  adj_agg AS (
    SELECT
      COALESCE(SUM(CASE WHEN adjustment_type='cash_in' THEN amount_ll END),0)::DECIMAL(12,2) AS in_ll,
      COALESCE(SUM(CASE WHEN adjustment_type='cash_in' THEN amount_usd END),0)::DECIMAL(12,2) AS in_usd,
      COALESCE(SUM(CASE WHEN adjustment_type='cash_out' THEN amount_ll END),0)::DECIMAL(12,2) AS out_ll,
      COALESCE(SUM(CASE WHEN adjustment_type='cash_out' THEN amount_usd END),0)::DECIMAL(12,2) AS out_usd
    FROM cash_adjustments WHERE shift_id = p_shift_id
  )
  SELECT v_store_id, v_business_date, v_status,
    v_opening_ll, v_opening_usd, v_closing_ll, v_closing_usd, v_verified,
    txn_agg.sold, txn_agg.cash_in, txn_agg.chg, adj_agg.in_ll, adj_agg.out_ll,
    (v_opening_ll + txn_agg.cash_in - txn_agg.chg + adj_agg.in_ll - adj_agg.out_ll)::DECIMAL(12,2) AS expected_ll,
    (v_opening_usd + txn_agg.cash_in_usd - txn_agg.chg_usd + adj_agg.in_usd - adj_agg.out_usd)::DECIMAL(12,2) AS expected_usd,
    CASE WHEN v_closing_ll IS NOT NULL THEN (v_closing_ll - (v_opening_ll + txn_agg.cash_in - txn_agg.chg + adj_agg.in_ll - adj_agg.out_ll))::DECIMAL(12,2) ELSE NULL END AS variance_ll,
    CASE WHEN v_closing_usd IS NOT NULL THEN (v_closing_usd - (v_opening_usd + txn_agg.cash_in_usd - txn_agg.chg_usd + adj_agg.in_usd - adj_agg.out_usd))::DECIMAL(12,2) ELSE NULL END AS variance_usd,
    txn_agg.cnt
  FROM txn_agg, adj_agg;
END;
$$ LANGUAGE plpgsql;

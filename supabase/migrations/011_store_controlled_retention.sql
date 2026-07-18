-- Store-Controlled Transaction Retention Policy
-- Adds per-store retention settings and automatic cleanup

-- ============================================================================
-- ADD RETENTION COLUMNS TO STORES
-- ============================================================================

ALTER TABLE stores 
  ADD COLUMN IF NOT EXISTS transaction_retention_days INTEGER DEFAULT 90,
  ADD COLUMN IF NOT EXISTS max_transactions INTEGER DEFAULT 5000;

-- Add comment
COMMENT ON COLUMN stores.transaction_retention_days IS 'Number of days to retain transactions. NULL means unlimited time.';
COMMENT ON COLUMN stores.max_transactions IS 'Maximum number of transactions to keep. NULL means unlimited count. Oldest transactions are deleted first.';

-- Add USD and payment_method columns to transactions if they don't exist
ALTER TABLE transactions 
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS usd_subtotal DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS usd_total_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS usd_amount_paid DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS usd_change_given DECIMAL(10,2);

-- ============================================================================
-- HELPER FUNCTION: Get retention settings for a store
-- ============================================================================

CREATE OR REPLACE FUNCTION get_store_retention_settings(p_store_id UUID)
RETURNS TABLE(
  retention_days INTEGER,
  max_transactions INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.transaction_retention_days,
    s.max_transactions
  FROM stores s
  WHERE s.id = p_store_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_store_retention_settings(UUID) TO authenticated;

-- ============================================================================
-- SMART CLEANUP FUNCTION: Respects per-store settings
-- ============================================================================

-- Drop the old function (returns INTEGER) before creating the new one (returns TABLE)
DROP FUNCTION IF EXISTS cleanup_old_transactions_for_store(UUID);

CREATE OR REPLACE FUNCTION cleanup_old_transactions_for_store(p_store_id UUID)
RETURNS TABLE(
  deleted_count INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_deleted_count INTEGER;
  v_retention_days INTEGER;
  v_max_txns INTEGER;
  v_total_txns INTEGER;
BEGIN
  -- Get store retention settings
  SELECT transaction_retention_days, max_transactions 
  INTO v_retention_days, v_max_txns
  FROM stores 
  WHERE id = p_store_id;
  
  -- Defaults if NULL
  IF v_retention_days IS NULL THEN
    v_retention_days := 90;
  END IF;
  
  IF v_max_txns IS NULL THEN
    v_max_txns := 5000;
  END IF;
  
  -- Count current transactions
  SELECT COUNT(*) INTO v_total_txns
  FROM transactions
  WHERE store_id = p_store_id;
  
  -- Determine cleanup reason
  IF v_total_txns > v_max_txns THEN
    -- Too many transactions - delete oldest beyond max
    DELETE FROM transactions 
    WHERE store_id = p_store_id 
    AND id IN (
      SELECT id FROM transactions 
      WHERE store_id = p_store_id 
      ORDER BY created_at ASC 
      LIMIT (v_total_txns - v_max_txns)
    );
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
  ELSIF v_retention_days > 0 THEN
    -- Time-based cleanup
    DELETE FROM transactions 
    WHERE store_id = p_store_id 
    AND created_at < NOW() - (v_retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    
  ELSE
    -- No cleanup needed
    v_deleted_count := 0;
  END IF;
  
  RETURN QUERY SELECT v_deleted_count, 
    CASE 
      WHEN v_total_txns > v_max_txns THEN 'Exceeded max_transactions limit'
      WHEN v_retention_days > 0 THEN 'Exceeded retention period'
      ELSE 'Within limits'
    END;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION cleanup_old_transactions_for_store(UUID) TO authenticated;

-- ============================================================================
-- BATCH CLEANUP: Clean all stores
-- ============================================================================

-- Drop the old function if it exists and has different signature
DROP FUNCTION IF EXISTS cleanup_all_stores_transactions();

CREATE OR REPLACE FUNCTION cleanup_all_stores_transactions()
RETURNS TABLE(
  store_id UUID,
  deleted_count INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_store_record RECORD;
  v_result_record RECORD;
BEGIN
  FOR v_store_record IN 
    SELECT id FROM stores
  LOOP
    FOR v_result_record IN
      SELECT deleted_count, reason FROM cleanup_old_transactions_for_store(v_store_record.id)
    LOOP
      store_id := v_store_record.id;
      deleted_count := v_result_record.deleted_count;
      reason := v_result_record.reason;
      RETURN NEXT;
    END LOOP;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION cleanup_all_stores_transactions() TO service_role;

-- ============================================================================
-- VIEW: Monitor transaction storage per store
-- ============================================================================

CREATE OR REPLACE VIEW store_transaction_health AS
SELECT 
  s.id AS store_id,
  s.username,
  s.transaction_retention_days,
  s.max_transactions,
  COUNT(t.id) AS current_transaction_count,
  MIN(t.created_at) AS oldest_transaction,
  MAX(t.created_at) AS newest_transaction,
  pg_size_pretty(SUM(pg_column_size(t.*))) AS estimated_size,
  -- Health status
  CASE 
    WHEN COUNT(t.id) = 0 THEN 'empty'
    WHEN COUNT(t.id) > s.max_transactions THEN 'over_limit'
    WHEN s.transaction_retention_days > 0 
      AND MIN(t.created_at) < NOW() - (s.transaction_retention_days || ' days')::INTERVAL 
    THEN 'expired'
    ELSE 'healthy'
  END AS status
FROM stores s
LEFT JOIN transactions t ON t.store_id = s.id
GROUP BY s.id, s.username, s.transaction_retention_days, s.max_transactions
ORDER BY current_transaction_count DESC;

GRANT SELECT ON store_transaction_health TO authenticated;

-- ============================================================================
-- FUNCTION: Get stores approaching limits
-- ============================================================================

CREATE OR REPLACE FUNCTION get_stores_near_limits()
RETURNS TABLE(
  store_id UUID,
  username TEXT,
  current_count BIGINT,
  max_limit INTEGER,
  percentage_used NUMERIC,
  oldest_transaction TIMESTAMPTZ,
  retention_days INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.username,
    COALESCE(COUNT(t.id), 0)::BIGINT,
    s.max_transactions,
    ROUND((COUNT(t.id)::NUMERIC / NULLIF(s.max_transactions, 0)) * 100, 2),
    MIN(t.created_at),
    s.transaction_retention_days
  FROM stores s
  LEFT JOIN transactions t ON t.store_id = s.id
  GROUP BY s.id, s.username, s.max_transactions, s.transaction_retention_days
  HAVING COUNT(t.id) > (s.max_transactions * 0.8) -- >80% of limit
  OR (s.transaction_retention_days > 0 
      AND MIN(t.created_at) < NOW() - (s.transaction_retention_days * 0.9 || ' days')::INTERVAL)
  ORDER BY percentage_used DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_stores_near_limits() TO service_role;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION cleanup_old_transactions_for_store(UUID) IS 'Deletes old transactions for a store based on its retention settings. Returns count and reason.';
COMMENT ON FUNCTION cleanup_all_stores_transactions() IS 'Cleans up all stores transactions respecting their individual retention settings.';
COMMENT ON VIEW store_transaction_health IS 'Shows transaction health status per store including usage and limits.';
COMMENT ON FUNCTION get_stores_near_limits() IS 'Returns stores approaching their transaction limits (>80% usage).';
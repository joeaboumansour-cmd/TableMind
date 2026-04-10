-- Transaction Retention Policy (48-hour TTL)
-- This migration adds automatic cleanup for transactions older than 48 hours

-- ============================================================================
-- INDEX FOR EFFICIENT QUERYING
-- ============================================================================

-- Create an index on created_at for efficient filtering and sorting
-- Note: Cannot use NOW() in partial index predicate as it's not immutable
CREATE INDEX IF NOT EXISTS idx_transactions_created_at_desc 
ON transactions(created_at DESC);

-- Create composite index for store-specific queries
CREATE INDEX IF NOT EXISTS idx_transactions_store_created_at 
ON transactions(store_id, created_at DESC);

-- ============================================================================
-- CLEANUP FUNCTION
-- ============================================================================

-- Function to delete transactions older than 48 hours
-- This can be called manually or via a scheduled trigger
CREATE OR REPLACE FUNCTION cleanup_old_transactions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete transactions older than 48 hours
  -- The ON DELETE CASCADE on transaction_items will automatically clean up line items
  DELETE FROM transactions 
  WHERE created_at < NOW() - INTERVAL '48 hours';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STORE-SPECIFIC CLEANUP FUNCTION
-- ============================================================================

-- Function to clean up old transactions for a specific store
-- Useful for targeted cleanup or maintenance tasks
CREATE OR REPLACE FUNCTION cleanup_old_transactions_for_store(p_store_id UUID)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM transactions 
  WHERE store_id = p_store_id 
  AND created_at < NOW() - INTERVAL '48 hours';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CLEANUP ALL STORES FUNCTION
-- ============================================================================

-- Function to clean up old transactions for all stores
-- Returns a JSON object with counts per store
CREATE OR REPLACE FUNCTION cleanup_all_old_transactions()
RETURNS TABLE(store_id UUID, deleted_count INTEGER) AS $$
BEGIN
  RETURN QUERY
  WITH deleted AS (
    DELETE FROM transactions 
    WHERE created_at < NOW() - INTERVAL '48 hours'
    RETURNING store_id
  )
  SELECT store_id, COUNT(*)::INTEGER as deleted_count
  FROM deleted
  GROUP BY store_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STATISTICS VIEW
-- ============================================================================

-- View to see transaction statistics and identify stores with old data
CREATE OR REPLACE VIEW transaction_retention_stats AS
SELECT 
  store_id,
  COUNT(*) as total_transactions,
  COUNT(CASE WHEN created_at < NOW() - INTERVAL '48 hours' THEN 1 END) as expired_transactions,
  MIN(created_at) as oldest_transaction,
  MAX(created_at) as newest_transaction,
  pg_size_pretty(SUM(pg_column_size(transactions.*))) as estimated_size
FROM transactions
GROUP BY store_id
ORDER BY expired_transactions DESC, total_transactions DESC;

-- ============================================================================
-- MAINTENANCE HELPER FUNCTION
-- ============================================================================

-- Function to get a report of transactions that will be deleted
-- Useful for auditing before cleanup
CREATE OR REPLACE FUNCTION get_transactions_for_cleanup()
RETURNS TABLE(
  id UUID,
  store_id UUID,
  transaction_number TEXT,
  total_amount DECIMAL,
  created_at TIMESTAMPTZ,
  hours_old FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.store_id,
    t.transaction_number,
    t.total_amount,
    t.created_at,
    EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600 as hours_old
  FROM transactions t
  WHERE t.created_at < NOW() - INTERVAL '48 hours'
  ORDER BY t.created_at ASC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Allow store users to execute cleanup functions for their own store
-- Note: RLS policies should still enforce store isolation
GRANT EXECUTE ON FUNCTION cleanup_old_transactions() TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_transactions_for_store(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_all_old_transactions() TO authenticated;
GRANT EXECUTE ON FUNCTION get_transactions_for_cleanup() TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION cleanup_old_transactions() IS 'Deletes all transactions older than 48 hours. Returns count of deleted records.';
COMMENT ON FUNCTION cleanup_old_transactions_for_store(UUID) IS 'Deletes transactions older than 48 hours for a specific store. Returns count of deleted records.';
COMMENT ON FUNCTION cleanup_all_old_transactions() IS 'Deletes all expired transactions and returns count per store.';
COMMENT ON VIEW transaction_retention_stats IS 'Shows transaction retention statistics per store, including count of expired transactions.';
COMMENT ON FUNCTION get_transactions_for_cleanup() IS 'Returns a list of transactions that are older than 48 hours and eligible for cleanup.';
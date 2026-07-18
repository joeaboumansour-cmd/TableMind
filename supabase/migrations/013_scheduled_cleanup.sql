-- Scheduled Transaction Cleanup
-- Can be called by Supabase scheduled jobs (cron) for periodic cleanup
-- Also handles cleanup when no new transactions are being inserted

-- ============================================================================
-- FUNCTION: Scheduled cleanup for all stores
-- ============================================================================

CREATE OR REPLACE FUNCTION scheduled_transaction_cleanup()
RETURNS TABLE(
  store_id UUID,
  deleted_count INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_store_record RECORD;
  v_result RECORD;
  v_retention_days INTEGER;
  v_max_txns INTEGER;
  v_total_txns INTEGER;
  v_deleted_count INTEGER;
BEGIN
  -- Loop through all stores
  FOR v_store_record IN 
    SELECT id, transaction_retention_days, max_transactions 
    FROM stores
  LOOP
    -- Get store settings with defaults
    v_retention_days := COALESCE(v_store_record.transaction_retention_days, 90);
    v_max_txns := COALESCE(v_store_record.max_transactions, 5000);
    
    -- Count current transactions
    SELECT COUNT(*) INTO v_total_txns
    FROM transactions
    WHERE store_id = v_store_record.id;
    
    v_deleted_count := 0;
    
    -- Delete by count limit if exceeded
    IF v_total_txns > v_max_txns THEN
      DELETE FROM transactions 
      WHERE store_id = v_store_record.id 
      AND id IN (
        SELECT id FROM transactions 
        WHERE store_id = v_store_record.id 
        ORDER BY created_at ASC 
        LIMIT v_total_txns - v_max_txns
      );
      GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    END IF;
    
    -- Delete by time limit (older than retention days)
    IF v_retention_days > 0 AND v_deleted_count = 0 THEN
      DELETE FROM transactions 
      WHERE store_id = v_store_record.id 
      AND created_at < NOW() - (v_retention_days || ' days')::INTERVAL;
      GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    END IF;
    
    -- Return results
    store_id := v_store_record.id;
    deleted_count := v_deleted_count;
    reason := CASE 
      WHEN v_total_txns > v_max_txns THEN 'exceeded_max_transactions'
      WHEN v_retention_days > 0 THEN 'exceeded_retention_days'
      ELSE 'no_cleanup_needed'
    END;
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Grant to service role for scheduled jobs
GRANT EXECUTE ON FUNCTION scheduled_transaction_cleanup() TO service_role;

COMMENT ON FUNCTION scheduled_transaction_cleanup() IS 'Runs cleanup for all stores - can be scheduled via pg_cron or Supabase scheduled functions';
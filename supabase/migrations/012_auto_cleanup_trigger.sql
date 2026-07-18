-- Automatic Transaction Cleanup Trigger
-- Automatically cleans up old transactions when new ones are inserted
-- Ensures 90-day retention and max 5000 transactions per store

-- ============================================================================
-- TRIGGER FUNCTION: Auto cleanup after transaction insert
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_cleanup_transactions()
RETURNS TRIGGER AS $$
DECLARE
  v_retention_days INTEGER;
  v_max_txns INTEGER;
  v_current_txns INTEGER;
BEGIN
  -- Get store retention settings
  SELECT 
    COALESCE(transaction_retention_days, 90),
    COALESCE(max_transactions, 5000)
  INTO v_retention_days, v_max_txns
  FROM stores 
  WHERE id = NEW.store_id;
  
  -- Count current transactions for this store
  SELECT COUNT(*) INTO v_current_txns
  FROM transactions
  WHERE store_id = NEW.store_id;
  
  -- If we're at or over the limit, trigger cleanup
  IF v_current_txns >= v_max_txns THEN
    -- Delete the excess oldest transactions
    DELETE FROM transactions 
    WHERE store_id = NEW.store_id 
    AND id IN (
      SELECT id FROM transactions 
      WHERE store_id = NEW.store_id 
      ORDER BY created_at ASC 
      LIMIT v_current_txns - (v_max_txns - 1)
    );
  END IF;
  
  -- Time-based cleanup: delete transactions older than retention days
  IF v_retention_days > 0 THEN
    DELETE FROM transactions 
    WHERE store_id = NEW.store_id 
    AND created_at < NOW() - (v_retention_days || ' days')::INTERVAL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER: Auto cleanup on transaction insert
-- ============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_auto_cleanup_transactions ON transactions;

-- Create trigger that fires after each transaction insert
CREATE TRIGGER trigger_auto_cleanup_transactions
  AFTER INSERT ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION auto_cleanup_transactions();

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION auto_cleanup_transactions() TO authenticated;
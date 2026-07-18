-- Add user tracking to transactions
-- Track which user (employee or owner) processed each transaction

-- ============================================================================
-- ADD USER COLUMN TO TRANSACTIONS TABLE
-- ============================================================================

ALTER TABLE transactions 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES store_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_name TEXT;

-- Add comments
COMMENT ON COLUMN transactions.user_id IS 'ID of the user (employee) who processed the transaction';
COMMENT ON COLUMN transactions.user_name IS 'Display name of the user who processed the transaction (for quick lookup)';

-- ============================================================================
-- INDEX FOR SEARCH BY USER
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
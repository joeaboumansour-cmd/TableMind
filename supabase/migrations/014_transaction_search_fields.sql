-- Add WhatsApp phone tracking and search support to transactions
-- Allows filtering/searching transactions and tracking receipt delivery

-- ============================================================================
-- ADD COLUMNS TO TRANSACTIONS TABLE
-- ============================================================================

ALTER TABLE transactions 
  ADD COLUMN IF NOT EXISTS whatsapp_sent_to TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMPTZ;

-- Add comments
COMMENT ON COLUMN transactions.whatsapp_sent_to IS 'Phone number (Lebanese format) to which receipt was sent via WhatsApp';
COMMENT ON COLUMN transactions.whatsapp_sent_at IS 'Timestamp when receipt was sent to WhatsApp';

-- ============================================================================
-- INDEXES FOR SEARCH
-- ============================================================================

-- Index for searching by transaction number
CREATE INDEX IF NOT EXISTS idx_transactions_number 
  ON transactions(transaction_number);

-- Index for searching by phone number
CREATE INDEX IF NOT EXISTS idx_transactions_whatsapp_phone 
  ON transactions(whatsapp_sent_to);

-- Composite index for store + date range queries
CREATE INDEX IF NOT EXISTS idx_transactions_store_date 
  ON transactions(store_id, created_at DESC);
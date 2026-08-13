-- Digital Receipts: Public receipt tokens + store marketing info
-- Per-transaction unguessable token for public receipt URLs
-- Store contact info shown on e-receipts (free marketing)

-- ============================================================================
-- TRANSACTIONS: receipt_token
-- ============================================================================

-- Unguessable token used in public receipt URLs (/receipt/[token])
-- Generated client-side at checkout so it works fully offline.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS receipt_token TEXT;

-- Unique index so the public API can look up by token efficiently.
-- Partial index: only rows that have a token (older rows may be NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_receipt_token
  ON transactions(receipt_token)
  WHERE receipt_token IS NOT NULL;

-- ============================================================================
-- STORES: marketing / contact info shown on e-receipts
-- ============================================================================

-- Phone / WhatsApp number (single field per user request)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS phone_whatsapp TEXT;

-- Store address (for delivery info on the e-receipt)
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS address TEXT;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- The public receipt API uses the service role client, so no RLS policy
-- changes are needed for the public lookup. Existing permissive policies
-- (stores_select USING auth.uid() = id) remain unchanged.
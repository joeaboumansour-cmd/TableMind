-- ============================================================
-- Remove the employee "Send to WhatsApp" feature from transactions.
-- Digital receipts are now delivered via scannable QR codes only,
-- so the whatsapp_sent_to / whatsapp_sent_at columns are no longer
-- needed on the transactions table.
-- NOTE: This does NOT touch stores.phone_whatsapp / stores.address,
-- which are the store's own marketing contact shown on the e-receipt.
-- ============================================================

-- Drop the index on the whatsapp column first (if it exists)
DROP INDEX IF EXISTS idx_transactions_whatsapp_phone;

-- Remove WhatsApp send-tracking columns from transactions
ALTER TABLE transactions
  DROP COLUMN IF EXISTS whatsapp_sent_to,
  DROP COLUMN IF EXISTS whatsapp_sent_at;

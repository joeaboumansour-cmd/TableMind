-- =============================================
-- Add unique constraint on (store_id, transaction_number)
-- Prevents duplicate transactions from being inserted
-- when the sync engine pushes the same queued transaction twice
-- =============================================

-- First, clean up any existing duplicates (keep the first one)
DELETE FROM transactions t1
USING transactions t2
WHERE t1.id > t2.id
  AND t1.store_id = t2.store_id
  AND t1.transaction_number = t2.transaction_number;

-- Add the unique constraint
-- Using NULLS NOT DISTINCT ensures that NULL values are treated as equal
-- (PostgreSQL 15+), but for safety we'll use a partial unique index
-- since transaction_number should never be NULL in practice
CREATE UNIQUE INDEX idx_transactions_store_number_unique
ON transactions (store_id, transaction_number);
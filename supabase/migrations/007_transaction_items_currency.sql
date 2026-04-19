-- Add currency column to transaction_items table
-- Fixes PGRST204 error: Could not find the 'currency' column of 'transaction_items'

ALTER TABLE transaction_items 
ADD COLUMN currency VARCHAR(3) DEFAULT 'LL' CHECK (currency IN ('LL', 'USD'));

-- Update existing records to default currency
UPDATE transaction_items SET currency = 'LL' WHERE currency IS NULL;
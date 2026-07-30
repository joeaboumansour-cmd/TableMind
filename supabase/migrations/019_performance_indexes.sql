-- ===
-- Performance Indexes for Product Queries
-- ===

-- Add updated_at column to products table if it doesn't exist
-- This is needed for incremental sync (only fetch changed products)
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create a trigger to automatically update updated_at on row modification
CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_products_updated_at ON products;
CREATE TRIGGER trigger_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();

-- Index for incremental sync: fetch products updated since last sync
-- The DESC order ensures the most recently updated products are found first
CREATE INDEX IF NOT EXISTS idx_products_store_updated 
  ON products(store_id, updated_at DESC);

-- Index for barcode lookup (used by POS scan fallback)
-- Note: idx_products_barcode_store already exists from initial schema
-- This is a more specific index for store+barcode queries
CREATE INDEX IF NOT EXISTS idx_products_store_barcode_lookup 
  ON products(store_id, barcode);

-- Index for inventory search by name
CREATE INDEX IF NOT EXISTS idx_products_store_name 
  ON products(store_id, name);

-- Index for transaction queries by store and date
CREATE INDEX IF NOT EXISTS idx_transactions_store_created 
  ON transactions(store_id, created_at DESC);

-- Index for transaction items lookup by product
CREATE INDEX IF NOT EXISTS idx_transaction_items_product 
  ON transaction_items(product_id);

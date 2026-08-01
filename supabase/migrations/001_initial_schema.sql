-- GoldenSquirrel POS - Simplified Multi-Tenant Schema
-- Store-based isolation with license management

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ADMIN TABLES
-- ============================================================================

-- Admin users (you - the system administrator)
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- STORE TABLES
-- ============================================================================

-- Stores (each small shop/business gets one account)
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  license_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- STORE-SPECIFIC TABLES (All data isolated by store_id)
-- ============================================================================

-- Products (each store has its own products)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  barcode TEXT,
  cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  selling_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit_percentage DECIMAL(5,2) DEFAULT 0,
  stock_quantity INTEGER DEFAULT 0,
  min_stock_threshold INTEGER DEFAULT 5
);

-- Transactions (sales records per store)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_number TEXT NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(10,2),
  change_given DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction items (line items per transaction)
CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_stores_username ON stores(username);
CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_products_barcode_store ON products(store_id, barcode);
CREATE INDEX idx_transactions_store ON transactions(store_id);
CREATE INDEX idx_transactions_created ON transactions(created_at);
CREATE INDEX idx_transaction_items_store ON transaction_items(store_id);
CREATE INDEX idx_transaction_items_transaction ON transaction_items(transaction_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to access their own store data
CREATE POLICY "stores_select" ON stores FOR SELECT USING (auth.uid() = id);
CREATE POLICY "products_all" ON products FOR ALL USING (store_id = auth.uid());
CREATE POLICY "transactions_all" ON transactions FOR ALL USING (store_id = auth.uid());
CREATE POLICY "transaction_items_all" ON transaction_items FOR ALL USING (store_id = auth.uid());

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to check if store license is valid
CREATE OR REPLACE FUNCTION is_license_valid(store_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM stores 
    WHERE id = store_id 
    AND license_expires_at > NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- Function to decrement stock
-- Allows stock to go negative — no guard clause
CREATE OR REPLACE FUNCTION decrement_stock(product_id UUID, quantity INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE products 
  SET stock_quantity = stock_quantity - quantity
  WHERE id = product_id;
END;
$$ LANGUAGE plpgsql;

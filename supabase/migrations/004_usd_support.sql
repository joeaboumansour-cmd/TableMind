-- USD Support Migration
-- Adds USD conversion fields to stores and transactions tables

-- ============================================================================
-- STORE USD SETTINGS
-- ============================================================================

-- Add USD rate columns to stores table
ALTER TABLE stores 
ADD COLUMN usd_rate_sell DECIMAL(10,2) DEFAULT 90000,
ADD COLUMN usd_rate_return DECIMAL(10,2) DEFAULT 89000;

-- Update existing stores with default rates
UPDATE stores 
SET usd_rate_sell = 90000, usd_rate_return = 89000 
WHERE usd_rate_sell IS NULL OR usd_rate_return IS NULL;

-- ============================================================================
-- TRANSACTION USD FIELDS
-- ============================================================================

-- Add USD amount columns to transactions table
ALTER TABLE transactions
ADD COLUMN usd_subtotal DECIMAL(10,2) DEFAULT 0,
ADD COLUMN usd_total_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN usd_amount_paid DECIMAL(10,2) DEFAULT 0,
ADD COLUMN usd_change_given DECIMAL(10,2) DEFAULT 0;

-- ============================================================================
-- PRODUCT USD FIELDS
-- ============================================================================

-- Add USD price columns to products table
ALTER TABLE products
ADD COLUMN cost_price_usd DECIMAL(10,2) DEFAULT 0,
ADD COLUMN selling_price_usd DECIMAL(10,2) DEFAULT 0;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get current sell rate for a store
CREATE OR REPLACE FUNCTION get_store_sell_rate(p_store_id UUID)
RETURNS DECIMAL AS $$
BEGIN
  RETURN (SELECT usd_rate_sell FROM stores WHERE id = p_store_id);
END;
$$ LANGUAGE plpgsql;

-- Function to get current return rate for a store
CREATE OR REPLACE FUNCTION get_store_return_rate(p_store_id UUID)
RETURNS DECIMAL AS $$
BEGIN
  RETURN (SELECT usd_rate_return FROM stores WHERE id = p_store_id);
END;
$$ LANGUAGE plpgsql;

-- Function to convert LL to USD for sales (using sell rate)
CREATE OR REPLACE FUNCTION convert_ll_to_usd_sale(p_store_id UUID, p_ll_amount DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
  v_rate DECIMAL;
BEGIN
  v_rate := get_store_sell_rate(p_store_id);
  IF v_rate IS NULL OR v_rate = 0 THEN
    v_rate := 90000; -- Default fallback
  END IF;
  RETURN p_ll_amount / v_rate;
END;
$$ LANGUAGE plpgsql;

-- Function to convert LL to USD for returns/change (using return rate)
CREATE OR REPLACE FUNCTION convert_ll_to_usd_return(p_store_id UUID, p_ll_amount DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
  v_rate DECIMAL;
BEGIN
  v_rate := get_store_return_rate(p_store_id);
  IF v_rate IS NULL OR v_rate = 0 THEN
    v_rate := 89000; -- Default fallback
  END IF;
  RETURN p_ll_amount / v_rate;
END;
$$ LANGUAGE plpgsql;
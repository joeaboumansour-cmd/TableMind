-- Product Currency Refactor Migration
-- Adds currency field to products table and removes redundant USD columns

-- ============================================================================
-- ADD CURRENCY FIELD
-- ============================================================================

-- Add currency column to products table
ALTER TABLE products 
ADD COLUMN currency VARCHAR(3) DEFAULT 'LL' CHECK (currency IN ('LL', 'USD'));

-- Update existing products to default currency
UPDATE products SET currency = 'LL' WHERE currency IS NULL;

-- ============================================================================
-- REMOVE REDUNDANT USD COLUMNS
-- ============================================================================

-- Drop the redundant USD columns since we'll calculate on-the-fly
ALTER TABLE products DROP COLUMN IF EXISTS cost_price_usd;
ALTER TABLE products DROP COLUMN IF EXISTS selling_price_usd;

-- ============================================================================
-- UPDATE STORE USD RATES
-- ============================================================================

-- Ensure stores have the correct USD rates (90k for selling)
UPDATE stores 
SET usd_rate_sell = 90000, usd_rate_return = 89000 
WHERE usd_rate_sell IS NULL OR usd_rate_return IS NULL;

-- ============================================================================
-- HELPER FUNCTIONS FOR CURRENCY CONVERSION
-- ============================================================================

-- Function to convert product price to USD based on store rates
CREATE OR REPLACE FUNCTION convert_product_price_to_usd(
  p_store_id UUID,
  p_currency VARCHAR(3),
  p_amount DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  v_rate DECIMAL;
BEGIN
  -- If product is in USD, return as-is
  IF p_currency = 'USD' THEN
    RETURN p_amount;
  END IF;
  
  -- If product is in LL, convert using store's sell rate
  v_rate := get_store_sell_rate(p_store_id);
  IF v_rate IS NULL OR v_rate = 0 THEN
    v_rate := 90000; -- Default fallback
  END IF;
  
  RETURN p_amount / v_rate;
END;
$$ LANGUAGE plpgsql;

-- Function to convert USD to product currency based on store rates
CREATE OR REPLACE FUNCTION convert_usd_to_product_currency(
  p_store_id UUID,
  p_currency VARCHAR(3),
  p_amount DECIMAL
)
RETURNS DECIMAL AS $$
DECLARE
  v_rate DECIMAL;
BEGIN
  -- If product is in USD, return as-is
  IF p_currency = 'USD' THEN
    RETURN p_amount;
  END IF;
  
  -- If product is in LL, convert using store's sell rate
  v_rate := get_store_sell_rate(p_store_id);
  IF v_rate IS NULL OR v_rate = 0 THEN
    v_rate := 90000; -- Default fallback
  END IF;
  
  RETURN p_amount * v_rate;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UPDATE TRIGGERS FOR AUTOMATIC PROFIT CALCULATION
-- ============================================================================

-- Function to automatically calculate profit percentage
CREATE OR REPLACE FUNCTION calculate_profit_percentage()
RETURNS TRIGGER AS $$
BEGIN
  -- Only calculate if cost_price is not zero
  IF NEW.cost_price > 0 THEN
    NEW.profit_percentage = ((NEW.selling_price - NEW.cost_price) / NEW.cost_price) * 100;
  ELSE
    NEW.profit_percentage = 0;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic profit calculation
DROP TRIGGER IF EXISTS trigger_calculate_profit ON products;
CREATE TRIGGER trigger_calculate_profit
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION calculate_profit_percentage();
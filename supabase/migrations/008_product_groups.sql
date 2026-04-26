-- Product Groups / Master Products Migration
-- Solves the problem: multiple variants (flavors) with same price, different barcodes

-- ============================================================================
-- CREATE PRODUCT GROUPS TABLE
-- ============================================================================
CREATE TABLE product_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  selling_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit_percentage DECIMAL(5,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'LL' CHECK (currency IN ('LL', 'USD')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- EXTEND PRODUCTS TABLE WITH GROUP REFERENCE
-- ============================================================================
ALTER TABLE products 
ADD COLUMN product_group_id UUID REFERENCES product_groups(id) ON DELETE SET NULL,
ADD COLUMN variant_name TEXT;

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_product_groups_store ON product_groups(store_id);
CREATE INDEX idx_products_group ON products(product_group_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_groups_all" ON product_groups 
FOR ALL USING (store_id = auth.uid());

-- ============================================================================
-- AUTO SYNC TRIGGER: WHEN GROUP PRICE CHANGES UPDATE ALL CHILD PRODUCTS
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_product_group_prices()
RETURNS TRIGGER AS $$
BEGIN
  -- Update ALL child products when group price changes
  UPDATE products
  SET 
    cost_price = NEW.cost_price,
    selling_price = NEW.selling_price,
    profit_percentage = NEW.profit_percentage,
    currency = NEW.currency
  WHERE product_group_id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic price sync
DROP TRIGGER IF EXISTS trigger_sync_product_group ON product_groups;
CREATE TRIGGER trigger_sync_product_group
  AFTER UPDATE ON product_groups
  FOR EACH ROW
  WHEN (OLD.cost_price IS DISTINCT FROM NEW.cost_price 
        OR OLD.selling_price IS DISTINCT FROM NEW.selling_price
        OR OLD.profit_percentage IS DISTINCT FROM NEW.profit_percentage
        OR OLD.currency IS DISTINCT FROM NEW.currency)
  EXECUTE FUNCTION sync_product_group_prices();

-- ============================================================================
-- PROFIT CALCULATION TRIGGER FOR PRODUCT GROUPS
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_group_profit_percentage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cost_price > 0 THEN
    NEW.profit_percentage = ((NEW.selling_price - NEW.cost_price) / NEW.cost_price) * 100;
  ELSE
    NEW.profit_percentage = 0;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_calculate_group_profit ON product_groups;
CREATE TRIGGER trigger_calculate_group_profit
  BEFORE INSERT OR UPDATE ON product_groups
  FOR EACH ROW
  EXECUTE FUNCTION calculate_group_profit_percentage();

-- ============================================================================
-- WHEN PRODUCT IS ADDED TO GROUP: INHERIT PRICES AUTOMATICALLY
-- ============================================================================
CREATE OR REPLACE FUNCTION inherit_group_prices()
RETURNS TRIGGER AS $$
DECLARE
  v_group record;
BEGIN
  IF NEW.product_group_id IS NOT NULL THEN
    SELECT * INTO v_group FROM product_groups WHERE id = NEW.product_group_id;
    IF FOUND THEN
      NEW.cost_price = v_group.cost_price;
      NEW.selling_price = v_group.selling_price;
      NEW.profit_percentage = v_group.profit_percentage;
      NEW.currency = v_group.currency;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inherit_group_prices ON products;
CREATE TRIGGER trigger_inherit_group_prices
  BEFORE INSERT OR UPDATE OF product_group_id ON products
  FOR EACH ROW
  EXECUTE FUNCTION inherit_group_prices();

-- ============================================================================
-- HOW IT WORKS:
-- ============================================================================
-- 1. Create a Product Group ("Chips") with master price
-- 2. Assign all 7 flavor variants to this group (each keeps own barcode)
-- 3. Edit price ONCE on the group - ALL 7 products update automatically
-- 4. 100% backwards compatible - all existing code/scanning/checkout works!
-- 5. Each flavor still has separate stock tracking and sales reports
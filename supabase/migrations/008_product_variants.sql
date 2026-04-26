-- Product Variants Migration
-- Implements exactly what was requested: Single product with multiple barcodes / flavors

-- ============================================================================
-- EXTEND EXISTING PRODUCTS TABLE
-- ============================================================================
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES products(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS variant_name TEXT;

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_id);
-- Barcode index already exists

-- ============================================================================
-- HELPER FUNCTION: GET PRODUCT WITH INHERITED VALUES
-- ============================================================================
CREATE OR REPLACE FUNCTION get_product_with_inheritance(p_product_id UUID)
RETURNS TABLE (
  id UUID,
  store_id UUID,
  name TEXT,
  full_name TEXT,
  barcode TEXT,
  variant_name TEXT,
  parent_id UUID,
  cost_price DECIMAL(10,2),
  selling_price DECIMAL(10,2),
  profit_percentage DECIMAL(5,2),
  currency VARCHAR(3),
  stock_quantity INTEGER,
  min_stock_threshold INTEGER,
  is_variant BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.store_id,
    COALESCE(parent.name, p.name) as name,
    CASE 
      WHEN p.variant_name IS NOT NULL THEN COALESCE(parent.name, p.name) || ' - ' || p.variant_name
      ELSE COALESCE(parent.name, p.name)
    END as full_name,
    p.barcode,
    p.variant_name,
    p.parent_id,
    COALESCE(parent.cost_price, p.cost_price) as cost_price,
    COALESCE(parent.selling_price, p.selling_price) as selling_price,
    COALESCE(parent.profit_percentage, p.profit_percentage) as profit_percentage,
    COALESCE(parent.currency, p.currency) as currency,
    p.stock_quantity,
    p.min_stock_threshold,
    CASE WHEN p.parent_id IS NOT NULL THEN true ELSE false END as is_variant
  FROM products p
  LEFT JOIN products parent ON p.parent_id = parent.id
  WHERE p.id = p_product_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- BARCODE LOOKUP FUNCTION (USED BY SCANNER)
-- ============================================================================
CREATE OR REPLACE FUNCTION find_product_by_barcode(p_store_id UUID, p_barcode TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  full_name TEXT,
  barcode TEXT,
  variant_name TEXT,
  selling_price DECIMAL(10,2),
  currency VARCHAR(3),
  stock_quantity INTEGER,
  is_variant BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    COALESCE(parent.name, p.name) as name,
    CASE 
      WHEN p.variant_name IS NOT NULL THEN COALESCE(parent.name, p.name) || ' - ' || p.variant_name
      ELSE p.name
    END as full_name,
    p.barcode,
    p.variant_name,
    COALESCE(parent.selling_price, p.selling_price) as selling_price,
    COALESCE(parent.currency, p.currency) as currency,
    p.stock_quantity,
    CASE WHEN p.parent_id IS NOT NULL THEN true ELSE false END as is_variant
  FROM products p
  LEFT JOIN products parent ON p.parent_id = parent.id
  WHERE p.store_id = p_store_id 
    AND p.barcode = p_barcode
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HOW IT WORKS:
-- ============================================================================
-- 1. Every existing product works exactly as before
-- 2. When you add multiple barcodes to a product:
--    - Original product is the parent (holds price)
--    - Each additional barcode creates child row with parent_id set
--    - Child rows have own barcode, own variant name, own stock
-- 3. Price is NEVER stored on child rows, always inherited live from parent
-- 4. Edit price ONCE on parent - ALL variants automatically get new price
-- 5. 100% backwards compatible - all existing code continues working
-- 6. Scanning any barcode returns full_name = "Product Name - Variant Name"
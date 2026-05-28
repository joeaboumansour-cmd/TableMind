-- ============================================================================
-- REVERT MIGRATION 009: Product Templates
-- Safely handles partial/failed migration states
-- ============================================================================

-- 1. Drop product_view if it exists
DROP VIEW IF EXISTS product_view;

-- 2. Drop product_templates table with CASCADE (removes table, trigger, and function)
DROP TABLE IF EXISTS product_templates CASCADE;

-- 3. Drop new functions (cleanup if table never existed)
DROP FUNCTION IF EXISTS get_store_products(UUID);
DROP FUNCTION IF EXISTS find_product_by_barcode(UUID, TEXT);
DROP FUNCTION IF EXISTS calculate_template_profit();

-- 4. Drop template_id column (only if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.columns 
             WHERE table_name = 'products' AND column_name = 'template_id') THEN
    DROP INDEX IF EXISTS idx_products_template;
    ALTER TABLE products DROP COLUMN IF EXISTS template_id;
  END IF;
END $$;

-- 5. Re-add parent_id column (only if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM information_schema.columns 
                 WHERE table_name = 'products' AND column_name = 'parent_id') THEN
    ALTER TABLE products ADD COLUMN parent_id UUID REFERENCES products(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_id);
  END IF;
END $$;

-- 6. Re-add product_group_id column (only if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM information_schema.columns 
                 WHERE table_name = 'products' AND column_name = 'product_group_id') THEN
    ALTER TABLE products ADD COLUMN product_group_id UUID;
    CREATE INDEX IF NOT EXISTS idx_products_group ON products(product_group_id);
  END IF;
END $$;

-- 7. Recreate original find_product_by_barcode (from migration 008)
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

-- 8. Restore old get_product_with_inheritance function
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

-- 9. Restore old profit calculation trigger on products
CREATE OR REPLACE FUNCTION calculate_profit_percentage()
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

DROP TRIGGER IF EXISTS trigger_calculate_profit ON products;
CREATE TRIGGER trigger_calculate_profit
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION calculate_profit_percentage();

-- ============================================================================
-- DONE
-- ============================================================================
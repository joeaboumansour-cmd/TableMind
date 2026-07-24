-- Product Discount Support
-- Adds percentage discount field to products table

-- ============================================================================
-- ADD DISCOUNT COLUMN TO PRODUCTS TABLE
-- ============================================================================

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.discount_percentage IS 'Discount percentage applied to this product (0-100). 0 means no discount. Applied automatically at POS.';
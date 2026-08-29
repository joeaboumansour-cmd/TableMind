-- ============================================================================
-- 029: Product categories
-- ============================================================================
-- Groups products for the till's category rail and the inventory list.
--
-- Verified against the DEPLOYED database before writing (the repo is not a
-- reliable description of production — see the db-migration skill):
--   products currently has  id, store_id, name, barcode, cost_price,
--   selling_price, profit_percentage, stock_quantity, min_stock_threshold,
--   currency, variant_name, parent_id, product_group_id, discount_percentage,
--   updated_at.  Neither category_id nor a product_categories table exists.
--
-- FLAT, no nesting. products.parent_id already means "variant"; a second tree
-- in the same neighbourhood is how this gets confusing, and a two-level till
-- rail is a worse UI than one.
-- ============================================================================


-- ============================================================================
-- TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Position in the till rail. Ties broken by name. The whole list is
  -- rewritten on save — a store has tens of categories, not thousands.
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- Optional tile tint. Nullable: most stores will never set one.
  color       TEXT,
  -- Soft delete. A category that has ever held products is RETIRED, never
  -- destroyed — see the DELETE note below.
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Not redundant with the primary key: this is the target of the COMPOSITE
  -- foreign key from products below, which is what makes assigning a category
  -- across tenants structurally impossible.
  UNIQUE (id, store_id)
);

-- One live category per name per store. Case-insensitive, because "Drinks" and
-- "drinks" are the same rail tab to everyone except Postgres. Partial on
-- is_active so a retired category does not block reusing its name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_store_name
  ON product_categories(store_id, lower(name))
  WHERE is_active;

-- Drives the rail: every live category for a store, already in display order.
CREATE INDEX IF NOT EXISTS idx_categories_store_sort
  ON product_categories(store_id, sort_order, name);


-- ============================================================================
-- PRODUCTS.CATEGORY_ID
-- ============================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id UUID;

-- COMPOSITE foreign key, not a plain one on category_id.
--
-- (category_id, store_id) -> (id, store_id) means a product can only ever
-- reference a category belonging to its OWN store. The database enforces the
-- tenancy rule, so the write path needs no extra lookup to check it — which
-- matters because product writes happen on the till.
--
-- ON DELETE RESTRICT, deliberately:
--   * Never CASCADE. Deleting a category must not delete products — the same
--     rule migration 028 applied to transaction history.
--   * Not SET NULL either. The column-list form needed to null only
--     category_id is Postgres 15+, and this migration does not depend on a
--     server version it cannot verify. RESTRICT works everywhere and gives the
--     safer outcome anyway: the API mirrors the cash-register pattern from 027
--     — a category nothing references is deleted outright, a category that
--     holds products is RETIRED (is_active = false) and every row is kept.
--     A 23503 from this constraint is the signal to retire instead.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_fkey;
ALTER TABLE products
  ADD CONSTRAINT products_category_fkey
  FOREIGN KEY (category_id, store_id)
  REFERENCES product_categories(id, store_id)
  ON DELETE RESTRICT;

-- Filtering the till grid and the inventory list by category.
CREATE INDEX IF NOT EXISTS idx_products_store_category
  ON products(store_id, category_id);


-- ============================================================================
-- UPDATED_AT
-- ============================================================================
-- Same shape as update_products_updated_at() from 019. A separate function
-- rather than a shared one, matching how 019 did it.

CREATE OR REPLACE FUNCTION update_product_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_product_categories_updated_at ON product_categories;
CREATE TRIGGER trigger_product_categories_updated_at
  BEFORE UPDATE ON product_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_product_categories_updated_at();


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- RLS enabled with NO permissive policies, following 027. The service role
-- bypasses RLS, and every read/write path for this table goes through an API
-- route using createServiceRoleClient. This deliberately does NOT copy the
-- USING (true) pattern from the older migrations — that grants full read and
-- write to anyone holding the public anon key (audit P0-5).
--
-- NOTE for whoever wires the inventory screen: pos/products/page.tsx still
-- talks to Supabase directly with the ANON key. It therefore cannot read this
-- table. Category reads must go through /api/categories.

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

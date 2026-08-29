-- ============================================================================
-- 030: Product kind and stock unit
-- ============================================================================
-- Ingredients ARE products. A "Fries Sandwich" and the "Pickles" it consumes
-- both live in `products`; only `kind` separates them.
--
-- That choice is the whole reason this feature is small: the products cache,
-- the offline sync, the inventory screen, CSV import/export and the
-- decrement_stock RPC all work on ingredients for free. A separate
-- `ingredients` table would have duplicated every one of them.
-- ============================================================================


-- 'sellable'  — can be rung up at the till (the default; every existing row)
-- 'ingredient'— consumed BY a menu item, never sold on its own
--
-- NOT NULL DEFAULT back-fills every existing row with no table rewrite
-- (Postgres stores the default in the catalog since 11).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'sellable';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_kind_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_kind_check CHECK (kind IN ('sellable', 'ingredient'));
  END IF;
END $$;


-- ============================================================================
-- STOCK UNIT — the mitigation for the one silent way this feature loses money
-- ============================================================================
-- `stock_quantity` stays INTEGER. The ingredient's stock unit IS the recipe
-- unit: pickles are stock_unit 'g' with stock_quantity 4000, meaning 4000
-- grams, and a recipe consuming 20 means 20 grams. So decrement_stock needs no
-- change, no float maths goes near stock, and every existing consumer keeps
-- working. The cost is that you cannot express 0.5 g — recipes must be
-- authored in the smallest unit the shop actually counts.
--
-- The hazard this column exists to reduce: an owner enters pickles as 4 (jars)
-- and writes a recipe of 20 (grams). Stock goes to -4000 in a day and nobody
-- notices until a stock take. Putting the unit on the PRODUCT rather than on
-- each recipe row means there is exactly one answer to "what is one unit of
-- pickles", and the inventory row can render "4000 g" instead of a bare 4000.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_unit TEXT NOT NULL DEFAULT 'unit';


-- Splitting sellable products from ingredients: the till lists one, the
-- recipe editor's picker lists the other.
CREATE INDEX IF NOT EXISTS idx_products_store_kind
  ON products(store_id, kind);

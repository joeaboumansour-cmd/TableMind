-- ============================================================================
-- 036: Combos
-- ============================================================================
-- "Taouk Meal — sandwich, fries and a drink, 800,000" when the parts would
-- separately come to 950,000. The point is a bigger average ticket at a
-- discount the customer can see on the board outside.
--
-- ## A combo IS a product
--
-- Same trick as ingredients (migration 030): no new kind of sellable thing, no
-- parallel pricing, no second catalogue. A combo is an ordinary row in
-- `products` with its own selling_price, and what makes it a combo is having
-- rows in the table below. Exactly how a menu item is "a product that has
-- recipe_components".
--
-- That means the till, the menu grid, the public menu, categories, favourites,
-- CSV and analytics all treat it as a product for free.
--
-- ## The price is the combo's own selling_price
--
-- NOT a computed sum, and NOT a discount percentage off the parts. The whole
-- purpose is a round, advertised number the customer recognises. What the
-- children cost separately is a comparison for a menu board, never an input to
-- what is charged.
-- ============================================================================

CREATE TABLE IF NOT EXISTS combo_components (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- The thing sold. CASCADE: deleting the meal deletes its make-up, which has
  -- no meaning without it.
  combo_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- A thing that goes in it — a SELLABLE product, not an ingredient. The
  -- sandwich inside the meal is the same sandwich sold on its own, recipe and
  -- all. RESTRICT, so removing a product that a live combo depends on is
  -- refused rather than silently gutting the meal. Same rule as
  -- recipe_components.ingredient_product_id.
  item_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,

  -- How many of that item are in the combo. INTEGER: a meal contains two
  -- sandwiches or it does not; there is no half a drink. Portions are a
  -- RECIPE concern, and the sandwich's own recipe still handles those.
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 99),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A combo cannot contain itself. Does NOT prevent a longer cycle (A in B in
  -- A) — the API refuses to nest combos at all, which closes that off more
  -- simply than a recursive check here.
  CONSTRAINT combo_no_self CHECK (combo_product_id <> item_product_id),
  -- One row per item per combo: "two sandwiches" is quantity 2, not two rows.
  CONSTRAINT combo_unique_item UNIQUE (combo_product_id, item_product_id)
);

-- "What is in this meal" — the till and the editor both ask it.
CREATE INDEX IF NOT EXISTS idx_combo_by_combo
  ON combo_components(store_id, combo_product_id, sort_order);

-- "Which meals use this product" — needed to explain a refused delete.
CREATE INDEX IF NOT EXISTS idx_combo_by_item
  ON combo_components(store_id, item_product_id);


-- ============================================================================
-- UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_combo_components_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_combo_components_updated_at ON combo_components;
CREATE TRIGGER trigger_combo_components_updated_at
  BEFORE UPDATE ON combo_components
  FOR EACH ROW
  EXECUTE FUNCTION update_combo_components_updated_at();


-- ============================================================================
-- transaction_items.combo_children — what a sold meal contained
-- ============================================================================
-- Denormalised onto the sold line, exactly like `modifiers` (032) and `note`
-- (034), and for the same reason: a combo's make-up can be edited after the
-- sale, and a receipt must say what was actually handed over.
--
-- Kept SEPARATE from `modifiers`. Modifiers carry the flattened INGREDIENT
-- expansion that drives stock; this carries the products a human should read.
-- A cook needs "1 Taouk, 1 Fries, 1 Cola", not a list of grams. Folding both
-- into one column would put two meanings on one field, which is the mistake
-- the NULL-versus-[] rule on `modifiers` already exists to avoid.
--
-- Nullable, no default: every line ever sold before now stays NULL.
--
-- ⚠️ Apply BEFORE deploying the code that sends it. The transaction_items
-- insert failure is deliberately swallowed in POST /api/transactions, so
-- against a database without this column every sale would succeed with NO LINE
-- ITEMS, silently. Same hazard as 032 and 034.
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS combo_children JSONB;

COMMENT ON COLUMN transaction_items.combo_children IS
  'Products inside a sold combo, as sold. NULL on every non-combo line.';


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- RLS on, no permissive policies — following 027, 029, 031, 033 and 035. Every
-- path goes through /api/combos with the service role. Does NOT copy the
-- USING (true) pattern, which grants read and write to anyone holding the
-- public anon key (audit P0-5).

ALTER TABLE combo_components ENABLE ROW LEVEL SECURITY;

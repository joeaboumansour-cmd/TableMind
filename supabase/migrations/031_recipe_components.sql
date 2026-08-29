-- ============================================================================
-- 031: Recipe components
-- ============================================================================
-- What a menu item is made of, and what the cashier may change at the counter.
--
-- One row = one ingredient in one menu item. "Fries Sandwich" with bread,
-- fries, pickles and optional extra cheese is four rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS recipe_components (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- The thing being sold. CASCADE: deleting the sandwich deletes its recipe,
  -- which is correct — the recipe has no meaning without it.
  menu_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  -- The thing consumed. RESTRICT, NOT cascade: deleting an ingredient that a
  -- live recipe depends on must be REFUSED, not silently break the sandwich.
  -- Same principle as cash_shifts.register_id in migration 027 — the API
  -- catches the 23503 and explains, rather than working around it.
  ingredient_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,

  -- How much of the ingredient ONE unit of the menu item consumes, expressed
  -- in the ingredient's own products.stock_unit.
  --
  -- NUMERIC(12,3) for AUTHORING — "2.5 g of yeast" is a real bakery input.
  -- The deduction is integerised once, at the whole line
  -- (round(quantity * line_quantity)), never per unit: round(2.5 * 4) = 10,
  -- not round(2.5) * 4 = 12. Same rule as the cart's total-only rounding.
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),

  -- true  = comes with it. Included when the line is added, and its
  --         price_delta_ll is NOT charged (already in the menu price).
  -- false = an available add-on. Charged and deducted only when added.
  is_default BOOLEAN NOT NULL DEFAULT true,

  -- false on a default means "no X" is not offered — the bun.
  --
  -- Removing a default NEVER refunds. That is deliberate: crediting for a
  -- removal opens a negative-price surface through a control that needs only
  -- the `pos` permission, and undercharging is exactly what the inventory
  -- permission gate exists to prevent.
  is_removable BOOLEAN NOT NULL DEFAULT true,

  -- Ceiling on the TOTAL count for this component, default included.
  -- max_quantity 3 on a 1x default cheese means "+2 extra".
  max_quantity INTEGER NOT NULL DEFAULT 1 CHECK (max_quantity >= 1),

  -- Charged per extra unit, in LL, EXACT. Never rounded here — rounding to
  -- 5,000 happens once, on the cart total, in cartStore.getTotal().
  -- DECIMAL(14,2) per the db-migration skill: LL amounts overflow DECIMAL(10,2).
  price_delta_ll DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (price_delta_ll >= 0),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A sandwich cannot contain itself.
  CONSTRAINT recipe_no_self CHECK (menu_product_id <> ingredient_product_id),
  -- One row per ingredient per menu item: "extra cheese" is max_quantity on
  -- the cheese row, not a second cheese row.
  CONSTRAINT recipe_unique_component UNIQUE (menu_product_id, ingredient_product_id)
);

-- The recipe editor and the till both ask "what is in this menu item".
CREATE INDEX IF NOT EXISTS idx_recipe_menu
  ON recipe_components(store_id, menu_product_id, sort_order);

-- "Which menu items use this ingredient" — needed to explain a refused delete.
CREATE INDEX IF NOT EXISTS idx_recipe_ingredient
  ON recipe_components(store_id, ingredient_product_id);


-- ============================================================================
-- UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_recipe_components_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_recipe_components_updated_at ON recipe_components;
CREATE TRIGGER trigger_recipe_components_updated_at
  BEFORE UPDATE ON recipe_components
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_components_updated_at();


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- RLS on, no permissive policies — following 027, 029 and 033. Every path goes
-- through /api/recipes with the service role. Does NOT copy the USING (true)
-- pattern, which grants read and write to anyone holding the public anon key
-- (audit P0-5).
--
-- NOTE: pos/products/page.tsx talks to Supabase with the ANON key, so it
-- cannot read this table directly. Recipes must go through /api/recipes.

ALTER TABLE recipe_components ENABLE ROW LEVEL SECURITY;

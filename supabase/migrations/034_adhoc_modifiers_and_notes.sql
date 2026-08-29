-- ============================================================================
-- 034: Ad-hoc ingredients and line notes
-- ============================================================================
-- A taouk sandwich comes with chicken, coleslaw, garlic, ketchup and potatoes.
-- A customer wants it without ketchup, WITH hummus — and hummus is not in that
-- sandwich's recipe at all — and asks for it cut in half.
--
-- Two small columns cover all of that.
-- ============================================================================


-- ============================================================================
-- products.serving_qty — how much of an ingredient ONE portion is
-- ============================================================================
-- Adding hummus to a sandwich has to deplete hummus, and the recipe cannot say
-- how much because hummus is not in that recipe. Without an answer the choice
-- is between depleting 1 (wrong when stock is grams) or depleting nothing
-- (silent stock drift, which is the thing this whole feature is careful about).
--
-- So the INGREDIENT itself carries its portion size, in its own stock_unit:
-- hummus is stock_unit 'g' with serving_qty 30, meaning one scoop is 30 g.
--
-- Also used as the default quantity when authoring a recipe row, so the number
-- is stated once per ingredient rather than re-typed into every recipe.
--
-- NUMERIC(12,3) matches recipe_components.quantity. The deduction is still
-- integerised once at the whole line — see buildStockDecrements().
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS serving_qty NUMERIC(12,3) NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_serving_qty_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_serving_qty_check CHECK (serving_qty > 0);
  END IF;
END $$;

-- NOTE ON PRICE: an ad-hoc addition is charged the INGREDIENT PRODUCT'S OWN
-- selling_price. No new column — ingredients are products and already have one.
-- An owner sets "Hummus, ingredient, 30,000 LL" and that is what adding a
-- scoop costs; leave it 0 and it is free. This keeps pricing where the owner
-- already edits it, and keeps a cashier out of pricing decisions entirely.


-- ============================================================================
-- transaction_items.note — free text for one sold line
-- ============================================================================
-- "Cut in half", "extra spicy", "no ice". Things no ingredient list can say.
--
-- Deliberately a COLUMN and not another key inside `modifiers`: modifiers is an
-- array whose NULL/[] distinction is what the kitchen board filters tickets on
-- (migration 032), and folding an unrelated scalar into it would put two
-- meanings on one field.
--
-- Nullable, no default. Every line ever sold before now stays NULL.
--
-- ⚠️ Apply this BEFORE deploying the code that sends it. The transaction_items
-- insert failure is deliberately swallowed in POST /api/transactions (the sale
-- is already created and the money is taken), so against a database without
-- this column every sale would succeed with NO LINE ITEMS, silently. Same
-- hazard as migration 032.
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMENT ON COLUMN transaction_items.note IS
  'Free-text instruction for this line as sold ("cut in half"). NULL on ordinary lines.';

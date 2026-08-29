// =============================================
// Recipes — domain types
// =============================================
// A recipe is the list of ingredients behind one menu item, plus what the
// cashier is allowed to change about them at the counter.
// =============================================

export interface RecipeComponent {
  id: string;
  menu_product_id: string;
  ingredient_product_id: string;
  /** Consumed per ONE unit of the menu item, in the ingredient's stock_unit. */
  quantity: number;
  /** Comes with it by default (and its price is already in the menu price). */
  is_default: boolean;
  /** May the cashier say "no X"? Meaningless on a non-default component. */
  is_removable: boolean;
  /** Ceiling on the total count, default included. 3 on a 1x default = "+2". */
  max_quantity: number;
  /** Charged per EXTRA unit, LL, exact. Never rounded per line. */
  price_delta_ll: number;
  sort_order: number;
}

/** What the editor and the till post back. No id: the server rewrites the set. */
export interface RecipeComponentInput {
  ingredient_product_id: string;
  quantity: number;
  is_default: boolean;
  is_removable: boolean;
  max_quantity: number;
  price_delta_ll: number;
  sort_order: number;
}

/** Every recipe in a store, keyed by the menu product. */
export type RecipeMap = Record<string, RecipeComponent[]>;

export const MAX_COMPONENTS_PER_RECIPE = 40;

/**
 * Does this product have a recipe behind it?
 *
 * The till uses this to decide whether tapping a tile opens the modifier sheet
 * or adds the product straight to the cart. An empty array is NOT a recipe.
 */
export function hasRecipe(recipes: RecipeMap, productId: string): boolean {
  const components = recipes[productId];
  return Array.isArray(components) && components.length > 0;
}

/** Display order: authored order, then a stable tiebreak on the id. */
export function compareComponents(a: RecipeComponent, b: RecipeComponent): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id.localeCompare(b.id);
}

/**
 * Validate one authored component, returning the reason it is unusable.
 *
 * Shared by the API and the editor so the form cannot accept something the
 * server will reject, and the server never trusts that the form checked.
 */
export function validateComponent(input: Partial<RecipeComponentInput>): string | null {
  if (typeof input.ingredient_product_id !== "string" || !input.ingredient_product_id) {
    return "Pick an ingredient";
  }
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return "Quantity must be greater than zero";
  if (qty > 1_000_000) return "Quantity is out of range";

  const max = Number(input.max_quantity ?? 1);
  if (!Number.isInteger(max) || max < 1 || max > 99) {
    return "Max quantity must be a whole number between 1 and 99";
  }

  const delta = Number(input.price_delta_ll ?? 0);
  // Negative deltas are refused on purpose: a removal that credits money is a
  // negative-price surface behind a control that needs only `pos` permission.
  if (!Number.isFinite(delta) || delta < 0) return "Extra price cannot be negative";
  if (delta > 99_999_999) return "Extra price is out of range";

  return null;
}

// =============================================
// Combos — domain types and resolution
// =============================================
// A combo is a product whose price covers several other products. Selling one
// must charge the combo price, tell the kitchen what to actually make, and
// deplete everything inside it — including the recipe of any menu item within.
// =============================================

import type { CartLineModifier } from "@/lib/types/cart";
import type { RecipeMap } from "@/lib/recipes/types";

export interface ComboComponent {
  id: string;
  combo_product_id: string;
  item_product_id: string;
  quantity: number;
  sort_order: number;
}

/** What the editor and the till post back. No id: the PUT replaces the set. */
export interface ComboComponentInput {
  item_product_id: string;
  quantity: number;
  sort_order: number;
}

/** Every combo in a store, keyed by the combo product. */
export type ComboMap = Record<string, ComboComponent[]>;

export const MAX_COMBO_ITEMS = 12;

/** Does this product's price cover other products? */
export function isCombo(combos: ComboMap, productId: string): boolean {
  const items = combos[productId];
  return Array.isArray(items) && items.length > 0;
}

export function compareComboComponents(a: ComboComponent, b: ComboComponent): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.id.localeCompare(b.id);
}

/** One line of "what the customer is getting", for the kitchen and receipt. */
export interface ComboChild {
  product_id: string;
  name: string;
  quantity: number;
}

/** Everything a combo cart line needs to carry. */
export interface ResolvedCombo {
  /** What to SHOW: "1x Taouk Sandwich, 1x Fries, 1x Cola". */
  children: ComboChild[];
  /**
   * What to DEPLETE, expressed as ordinary modifiers so buildStockDecrements
   * needs no knowledge of combos at all.
   */
  modifiers: CartLineModifier[];
}

/**
 * Flatten a combo into its display children and its stock expansion.
 *
 * ## Why flatten here and not at sale time
 *
 * Same rule as recipes: the combo AND the recipes of its children, AS THEY
 * WERE WHEN IT WAS SOLD, are the right ones. A meal sold offline on Monday and
 * synced on Wednesday must deplete what Monday's recipes said. Resolving on the
 * server later would use Wednesday's.
 *
 * ## Two levels, never more
 *
 * combo -> item -> (that item's recipe ingredients). A combo inside a combo is
 * refused by the API, so there is no deeper nesting to chase and no cycle to
 * guard against here.
 *
 * A child WITH a recipe contributes its ingredients. A child WITHOUT one (a
 * canned drink) contributes itself — exactly the rule buildStockDecrements
 * already applies to an ordinary line.
 */
export function resolveCombo(
  comboProductId: string,
  combos: ComboMap,
  recipes: RecipeMap,
  nameOf: (productId: string) => string
): ResolvedCombo {
  const items = (combos[comboProductId] || []).slice().sort(compareComboComponents);

  const children: ComboChild[] = [];
  const modifiers: CartLineModifier[] = [];

  for (const item of items) {
    children.push({
      product_id: item.item_product_id,
      name: nameOf(item.item_product_id),
      quantity: item.quantity,
    });

    const recipe = recipes[item.item_product_id];

    if (recipe && recipe.length > 0) {
      for (const component of recipe) {
        // Defaults only. A combo is rung up as the meal as advertised; a
        // cashier who needs "no pickles" edits the line afterwards, exactly as
        // they would on a standalone sandwich.
        if (!component.is_default) continue;
        modifiers.push({
          component_id: `${item.item_product_id}:${component.id}`,
          ingredient_product_id: component.ingredient_product_id,
          name: nameOf(component.ingredient_product_id),
          state: "included",
          // Multiplied by how many of that item are in the combo, so a meal
          // with two sandwiches consumes two sandwiches' worth of bread. The
          // line quantity is applied later, once, by buildStockDecrements.
          ingredient_qty: component.quantity * item.quantity,
          price_delta_ll: 0,
          count: 1,
          is_default_component: true,
        });
      }
      continue;
    }

    // No recipe: the item itself is the stock that moves.
    modifiers.push({
      component_id: `${item.item_product_id}:self`,
      ingredient_product_id: item.item_product_id,
      name: nameOf(item.item_product_id),
      state: "included",
      ingredient_qty: item.quantity,
      price_delta_ll: 0,
      count: 1,
      is_default_component: true,
    });
  }

  return { children, modifiers };
}

/** Validate one authored combo row, or say why it is unusable. */
export function validateComboComponent(
  input: Partial<ComboComponentInput>
): string | null {
  if (typeof input.item_product_id !== "string" || !input.item_product_id) {
    return "Pick a product";
  }
  const qty = Number(input.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return "Quantity must be a whole number between 1 and 99";
  }
  return null;
}

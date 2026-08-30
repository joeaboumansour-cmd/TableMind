// =============================================
// Combos — domain types and resolution
// =============================================
// A combo is a product whose price covers several other products. Selling one
// must charge the combo price, tell the kitchen what to actually make, and
// deplete everything inside it — including the recipe of any menu item within.
// =============================================

import type { CartLineModifier } from "@/lib/types/cart";
import type { RecipeMap } from "@/lib/recipes/types";
import { extraUnitPriceLl } from "@/lib/recipes/types";

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
  nameOf: (productId: string) => string,
  /** What one extra portion of an ingredient costs, in LL. */
  priceOf: (productId: string) => number = () => 0
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
      // ONE GROUP PER UNIT. A meal with two sandwiches produces two independent
      // sets of choices, so one can lose its pickles while the other keeps
      // them. Sharing one set across both was the obvious first cut and is
      // simply wrong at a counter: two customers order the same meal
      // differently all the time.
      for (let instance = 0; instance < item.quantity; instance++) {
      const childId =
        item.quantity > 1
          ? `${item.item_product_id}#${instance}`
          : item.item_product_id;
      const childName =
        item.quantity > 1
          ? `${nameOf(item.item_product_id)} (${instance + 1} of ${item.quantity})`
          : nameOf(item.item_product_id);

      for (const component of recipe) {
        // EVERY component, not just the defaults — exactly as a standalone
        // sandwich opens. A default arrives included; an optional extra
        // arrives switched off but PRESENT, so the cashier can add it. Dropping
        // the optional ones meant a sandwich inside a meal silently offered
        // fewer choices than the same sandwich sold on its own.
        modifiers.push({
          component_id: `${childId}:${component.id}`,
          ingredient_product_id: component.ingredient_product_id,
          name: nameOf(component.ingredient_product_id),
          state: component.is_default ? "included" : "removed",
          // Per INSTANCE now, not multiplied by the combo quantity: two
          // sandwiches means two groups each consuming one sandwich's worth,
          // which sums to the same total while staying independently editable.
          // The line quantity is applied later, once, by buildStockDecrements.
          ingredient_qty: component.quantity,
          // The meal price covers the standard sandwich; an extra still costs
          // extra. Same rule as a standalone sandwich — extraUnitPriceLl —
          // because the two used to disagree, and a customer asking for extra
          // chicken should be charged the same either way.
          price_delta_ll: extraUnitPriceLl(
            component.price_delta_ll,
            priceOf(component.ingredient_product_id)
          ),
          count: component.is_default ? 1 : 0,
          is_default_component: component.is_default,
          combo_child_id: childId,
          combo_child_name: childName,
        });
      }
      }
      continue;
    }

    // No recipe: the item itself is the stock that moves. Marked as its own
    // child (combo_child_id === ingredient_product_id) so the sheet knows to
    // hide it — there is nothing to change about a canned drink, and showing
    // it as a removable "ingredient" invites removing it from a paid meal.
    modifiers.push({
      component_id: `${item.item_product_id}:self`,
      ingredient_product_id: item.item_product_id,
      name: nameOf(item.item_product_id),
      state: "included",
      ingredient_qty: item.quantity,
      price_delta_ll: 0,
      count: 1,
      is_default_component: true,
      combo_child_id: item.item_product_id,
      combo_child_name: nameOf(item.item_product_id),
      is_combo_fixed: true,
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

// =============================================
// Sellable products vs ingredients
// =============================================
// Ingredients live in `products` alongside the things customers buy, so every
// surface that lists "the catalogue" has to say which one it means.
// =============================================

export type ProductKind = "sellable" | "ingredient";

/**
 * Can this be rung up at the till?
 *
 * ⚠️ READ THIS BEFORE CHANGING IT.
 *
 * This is `!== "ingredient"`, NOT `=== "sellable"`, and the difference is a
 * shop-stopping bug.
 *
 * `kind` is OPTIONAL on CachedProduct because a device whose IndexedDB was
 * populated before migration 030 has `undefined` on every single row. With
 * `=== "sellable"` that till would show an EMPTY CATALOGUE — on the busiest
 * screen in the app, until a full product pull completed, with no internet
 * required to trigger it.
 *
 * Default-sellable is the safe direction: the worst case is that an ingredient
 * is briefly visible on the till, which a cashier can simply not tap. The
 * other way round, nobody can sell anything.
 */
export function isSellable(product: { kind?: string | null }): boolean {
  return product.kind !== "ingredient";
}

/** The inverse. Same defaulting rule, stated once. */
export function isIngredient(product: { kind?: string | null }): boolean {
  return product.kind === "ingredient";
}

/** Normalise anything into a valid kind. Unknown input becomes sellable. */
export function normaliseKind(value: unknown): ProductKind {
  return value === "ingredient" ? "ingredient" : "sellable";
}

/**
 * Units an ingredient's stock can be counted in.
 *
 * A suggestion list, not a constraint — the column is free text, because a
 * Lebanese shop counts things this list will not have thought of. The point of
 * offering presets is to nudge an owner towards the SMALLEST unit they count,
 * since stock_quantity is an integer and a recipe cannot express half of one.
 */
export const STOCK_UNITS = [
  { value: "unit", label: "unit (whole items)" },
  { value: "g", label: "g (grams)" },
  { value: "ml", label: "ml (millilitres)" },
  { value: "piece", label: "piece (slices, leaves)" },
] as const;

/** "4000 g", or "12 unit" -> "12". Never a bare number for an ingredient. */
export function formatStock(quantity: number, stockUnit?: string | null): string {
  const unit = stockUnit || "unit";
  if (unit === "unit") return String(quantity);
  return `${quantity} ${unit}`;
}

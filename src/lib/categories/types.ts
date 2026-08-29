// =============================================
// Product categories — domain types
// =============================================
// A category groups products for the till's category rail and the inventory
// list. FLAT, no nesting: `products.parent_id` already means "variant", and a
// two-level rail is a worse UI than one.
//
// Categories are a DISPLAY convenience. Nothing about money, stock or a sale
// depends on them, which is why the local copy can live in localStorage and a
// stale copy is allowed to degrade to "an extra empty tab".
// =============================================

export interface ProductCategoryRow {
  id: string;
  store_id: string;
  name: string;
  /** Position in the rail. Ties broken by name. */
  sort_order: number;
  /** Optional tile tint. Null for almost every store. */
  color: string | null;
  /**
   * False = retired. A category that has ever held products is retired rather
   * than deleted, mirroring how a cash register with shift history is retired
   * (migration 027). Retired categories are not returned by the API.
   */
  is_active: boolean;
}

/** What the till and the inventory list actually render. */
export type Category = Pick<
  ProductCategoryRow,
  "id" | "name" | "sort_order" | "color"
>;

/** Field limits, shared by the API validator and the admin form. */
export const CATEGORY_NAME_MAX = 60;
export const CATEGORY_SORT_MAX = 10_000;

/**
 * Display order: `sort_order` first, then name, case-insensitively.
 *
 * Defined once and used by BOTH the API and the client, so the rail cannot
 * disagree with the list it was loaded from.
 */
export function compareCategories(a: Category, b: Category): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Normalise a name for the uniqueness check.
 *
 * Mirrors the partial unique index in migration 029, which is on
 * `lower(name)` — "Drinks" and "drinks" are the same rail tab to everyone
 * except Postgres.
 */
export function normaliseCategoryName(name: string): string {
  return name.trim().toLowerCase();
}

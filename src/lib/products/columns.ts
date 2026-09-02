// =============================================
// The product column list, in one place both sides can import.
//
// This used to live in products/refresh.ts, which is fine while only the
// browser reads products. `GET /api/products` now issues that same select on
// the server, and refresh.ts imports Dexie — so importing it from a route
// would drag IndexedDB into a serverless function.
//
// Split rather than duplicated on purpose: a column missing from this list does
// not fail, it caches as `undefined` and shows up as a BROKEN PRICE at the
// till. Two copies drifting apart is exactly that bug with a delay on it.
// =============================================

/**
 * The columns a CachedProduct is built from — exactly the fields of
 * CachedProduct. Replaces `select("*")`: the table also carries columns nothing
 * reads (product_group_id), and on a ~2,300-row catalogue those ride along on
 * every page of every sync.
 *
 * MONEY: every price-bearing field travels through this list and
 * `mapToCachedProduct()`. Treat the two as a single unit when editing either.
 */
export const PRODUCT_COLUMNS =
  "id, store_id, name, barcode, cost_price, selling_price, currency, profit_percentage, discount_percentage, stock_quantity, min_stock_threshold, category_id, kind, stock_unit, serving_qty, parent_id, variant_name, updated_at";

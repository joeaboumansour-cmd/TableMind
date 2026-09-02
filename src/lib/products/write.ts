"use client";

/**
 * Product writes that survive no internet.
 *
 * The catalogue used to be written straight from the browser with the Supabase
 * client, so creating or repricing a product simply failed during an outage.
 * That is fine for a back-office screen and useless at a till, where the whole
 * point of the unknown-barcode flow is that it works when the line is down.
 *
 * The order here is deliberate:
 *
 *   1. The id is generated ON THE CLIENT. That is what makes the eventual
 *      server call an idempotent upsert rather than an insert that could run
 *      twice, and it means the cart can reference a real product id
 *      immediately.
 *   2. `products_cache` is written FIRST and awaited. The product is sellable
 *      from that moment — the next scan finds it, offline included.
 *   3. The server call is attempted. On ANY failure (not just a known-offline
 *      state — a request can fail after the check) the write is queued for the
 *      sync engine, which retries it on reconnect, tab focus and its 30s tick.
 *
 * Note the reconcile guard this depends on: `reconcileProductsCache()` will not
 * delete a cached product that still has a `product_upsert` queued, because
 * the server's ID set cannot contain something it has never been told about.
 */

import type { CachedProduct } from "@/lib/db/localDB";
import { buildAuthHeaders } from "@/lib/auth/requestHeaders";
import { convertUsdToLl, convertLlToUsdForReturn } from "@/lib/utils/format";
import { logActivity } from "@/lib/activity/logger";

export interface ProductWriteInput {
  store_id: string;
  name: string;
  barcode?: string | null;
  /** Price in the product's own currency. LL unless `currency` says otherwise. */
  selling_price: number;
  currency?: "LL" | "USD";
  cost_price?: number;
  profit_percentage?: number;
  discount_percentage?: number;
  stock_quantity?: number;
  min_stock_threshold?: number;
  category_id?: string | null;
  kind?: string | null;
  stock_unit?: string | null;
  serving_qty?: number | null;
  /**
   * Variant identity, for the LOCAL CACHE only.
   *
   * `POST /api/products` neither reads nor writes these two — its upsert only
   * touches the columns it validates, so the server keeps whatever the row
   * already had. They exist here so that editing a variant through this path
   * does not blank its parentage in `products_cache` until the next refresh
   * pulls the row back. Ordinary products leave them undefined.
   */
  parent_id?: string | null;
  variant_name?: string | null;
}

export interface ProductWriteResult {
  product: CachedProduct;
  /**
   * The server push, NOT awaited by the write itself.
   *
   * Resolves `true` when the write reached the server and `false` when it was
   * queued instead. **Rejects** when it could neither be pushed nor queued —
   * the one case where the product exists on this device and nowhere else,
   * which a caller must surface rather than swallow.
   *
   * It is a promise rather than a boolean because the product is durable and
   * sellable before this settles. A cashier who has just named an item with a
   * customer in front of them should not wait a network round trip to see it
   * reach the cart; the same reasoning as `saleCompletion.ts`, which paints the
   * receipt and pushes behind it.
   */
  pushed: Promise<boolean>;
}

function toCachedProduct(id: string, input: ProductWriteInput): CachedProduct {
  return {
    id,
    store_id: input.store_id,
    name: input.name,
    barcode: input.barcode === undefined ? null : input.barcode,
    cost_price: input.cost_price ?? 0,
    selling_price: input.selling_price,
    currency: input.currency || "LL",
    profit_percentage: input.profit_percentage ?? 0,
    discount_percentage: input.discount_percentage ?? 0,
    stock_quantity: input.stock_quantity ?? 0,
    min_stock_threshold: input.min_stock_threshold ?? 0,
    category_id: input.category_id ?? null,
    kind: input.kind || "sellable",
    stock_unit: input.stock_unit || "unit",
    serving_qty: input.serving_qty ?? 1,
    parent_id: input.parent_id ?? null,
    variant_name: input.variant_name ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Push a product row to the server, or queue it if that fails.
 * Never throws — the local cache write has already happened by this point and
 * a queued row is a complete outcome, not a failure.
 */
async function pushOrQueue(
  product: CachedProduct,
  mode: "create" | "update"
): Promise<boolean> {
  try {
    const response = await fetch("/api/products", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify(product),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error ${response.status}: ${body}`);
    }
    return true;
  } catch (error) {
    console.warn(`[Products] ${mode} not pushed; queued for sync:`, error);
    try {
      const { queueProductUpsert } = await import("@/lib/db/localDB");
      await queueProductUpsert({ product, mode });
    } catch (queueError) {
      // Both paths failed. The product still exists locally and is sellable,
      // but nothing will carry it to the server, so say so loudly rather than
      // letting it look saved.
      console.error("[Products] Could not queue the write either:", queueError);
      throw queueError;
    }
    return false;
  }
}

/**
 * Create a product and make it immediately sellable.
 *
 * @throws only if the local cache write fails, or the write could neither be
 *         pushed nor queued — i.e. cases where the product would silently not
 *         exist anywhere.
 */
export async function createProduct(
  input: ProductWriteInput
): Promise<ProductWriteResult> {
  const product = toCachedProduct(crypto.randomUUID(), input);

  // Durable FIRST, and awaited. Past this line the product is in the local
  // catalogue and sellable, with or without a network.
  const { upsertSingleProduct } = await import("@/lib/db/localDB");
  await upsertSingleProduct(product);

  // The push is NOT awaited. It was, and it cost the cashier a full round trip
  // between naming an unknown barcode and seeing the line reach the cart —
  // with the customer holding the item. Nothing about the product depends on
  // it: the id is generated here, so the server call is an idempotent upsert
  // that can happen whenever it happens.
  const pushed = pushOrQueue(product, "create").then((syncedNow) => {
    // Logged from inside, because `synced_now` is the interesting half — it
    // separates a catalogue change the server already has from one still
    // sitting in pending_writes — and it is not known until this settles.
    logActivity("catalog.product_create", {
      target: product.name,
      details: {
        product_id: product.id,
        barcode: product.barcode,
        selling_price: product.selling_price,
        cost_price: product.cost_price,
        currency: product.currency,
        stock_quantity: product.stock_quantity,
        synced_now: syncedNow,
      },
    });
    return syncedNow;
  });

  return { product, pushed };
}

/**
 * Update an existing product. The caller supplies the full row it wants
 * stored, because the server call is an upsert on the id — a partial patch
 * would blank the fields it omitted.
 */
export async function updateProduct(
  id: string,
  input: ProductWriteInput
): Promise<ProductWriteResult> {
  const product = toCachedProduct(id, input);

  // Durable first, push behind — the same reasoning as createProduct. This one
  // backs the cart line's price editor, so the wait it used to impose landed
  // between a cashier retyping a price and the cart showing it.
  const { upsertSingleProduct } = await import("@/lib/db/localDB");
  await upsertSingleProduct(product);

  const pushed = pushOrQueue(product, "update").then((syncedNow) => {
    logActivity("catalog.product_update", {
      target: product.name,
      details: {
        product_id: product.id,
        barcode: product.barcode,
        selling_price: product.selling_price,
        cost_price: product.cost_price,
        currency: product.currency,
        stock_quantity: product.stock_quantity,
        synced_now: syncedNow,
      },
    });
    return syncedNow;
  });

  return { product, pushed };
}

/**
 * What repricing an existing product from the till will do, worked out BEFORE
 * anything is written so the editor can show it.
 *
 * The cart and the catalogue do not speak the same language, and conflating
 * them is how a shop loses its USD pricing without noticing:
 *
 *   - a cart LINE is always charged in LL (that is what the drawer takes)
 *   - a catalogue PRODUCT has its own currency, and a USD-priced product is
 *     meant to track the exchange rate rather than sit at a fixed LL number
 *
 * So the catalogue price is edited in the PRODUCT's currency, and this returns
 * the consequences: the derived counter-currency, the recomputed profit, and
 * what a customer will actually pay once any existing discount is applied.
 */
export interface RepricePreview {
  currency: "LL" | "USD";
  /** The new catalogue price, in `currency`. */
  sellingPrice: number;
  /** The same price expressed in the other currency, for display. */
  counterpartLl: number;
  counterpartUsd: number;
  /** Recomputed from cost. Zero when there is no cost recorded. */
  profitPercentage: number;
  /** Carried over untouched — repricing is not a reason to drop a discount. */
  discountPercentage: number;
  /** What the customer pays per unit in LL, discount included. */
  effectiveUnitLl: number;
  /** True when the product's currency is being changed by this edit. */
  currencyChanged: boolean;
  previousCurrency: "LL" | "USD";
  previousSellingPrice: number;
}

/**
 * Profit relative to cost, matching the formula the Inventory form uses so the
 * two cannot disagree. Without this the product keeps the profit % it had
 * against its OLD price, and the next visit to the Inventory form recomputes
 * the selling price from that stale figure and silently undoes the correction.
 */
/** DECIMAL(10,2) after migration 025. */
const MAX_PROFIT_PCT = 99_999_999.99;

function profitFromCost(cost: number, selling: number): number {
  if (!cost || cost <= 0) return 0;
  const pct = ((selling - cost) / cost) * 100;
  if (!Number.isFinite(pct)) return 0;
  // A cost of 0.01 against an LL price produces a number no column can hold.
  // The database recomputes this field anyway; the clamp just keeps the value
  // we send storable so it can never be the reason a save is refused.
  return Math.max(-MAX_PROFIT_PCT, Math.min(MAX_PROFIT_PCT, pct));
}

/** Work out the consequences of a reprice without performing it. */
export function previewReprice(opts: {
  product: CachedProduct;
  currency: "LL" | "USD";
  sellingPrice: number;
}): RepricePreview {
  const { product, currency, sellingPrice } = opts;
  const previousCurrency: "LL" | "USD" = product.currency === "USD" ? "USD" : "LL";

  // Whichever side is derived goes through the named helpers. USD -> LL uses
  // the SELL rate (the customer is paying); LL -> USD uses the RETURN rate, to
  // match what the cart actually charges.
  const counterpartLl =
    currency === "USD" ? convertUsdToLl(sellingPrice) : sellingPrice;
  const counterpartUsd =
    currency === "USD" ? sellingPrice : convertLlToUsdForReturn(sellingPrice);

  const discountPercentage = product.discount_percentage || 0;

  return {
    currency,
    sellingPrice,
    counterpartLl,
    counterpartUsd,
    profitPercentage: profitFromCost(product.cost_price, sellingPrice),
    discountPercentage,
    effectiveUnitLl: counterpartLl * (1 - discountPercentage / 100),
    currencyChanged: currency !== previousCurrency,
    previousCurrency,
    previousSellingPrice: product.selling_price,
  };
}

/**
 * Reprice an existing product, keeping every other field as the cache has it.
 *
 * This is the cart-line "Inventory" edit. Reading the current row first is what
 * makes "everything else stays put" true, given that the server call is an
 * upsert on the id and a partial patch would blank what it omitted.
 *
 * Three things it deliberately does NOT do, each of which it used to:
 *   - it does not force the product to LL. A USD-priced product edited in USD
 *     stays USD and keeps tracking the rate.
 *   - it does not zero the discount. A wrong shelf price is not a reason to
 *     cancel a promotion.
 *   - it does not leave `profit_percentage` pointing at the old price.
 */
export async function repriceProduct(opts: {
  productId: string;
  storeId: string;
  name?: string;
  /** The new catalogue price, expressed in `currency`. */
  sellingPrice: number;
  /** Defaults to whatever the product is already priced in. */
  currency?: "LL" | "USD";
}): Promise<ProductWriteResult & { preview: RepricePreview }> {
  const { getCachedProductById } = await import("@/lib/db/localDB");
  const existing = await getCachedProductById(opts.productId);
  if (!existing) {
    throw new Error("That product is no longer in the local catalogue");
  }
  if (existing.store_id !== opts.storeId) {
    // Should be impossible — the cache is store-scoped — but a device that has
    // served two stores has both sets of rows in it.
    throw new Error("That product belongs to a different store");
  }

  const currency: "LL" | "USD" =
    opts.currency || (existing.currency === "USD" ? "USD" : "LL");
  const preview = previewReprice({ product: existing, currency, sellingPrice: opts.sellingPrice });

  const result = await updateProduct(opts.productId, {
    store_id: existing.store_id,
    name: opts.name === undefined ? existing.name : opts.name,
    barcode: existing.barcode,
    selling_price: opts.sellingPrice,
    currency,
    cost_price: existing.cost_price,
    profit_percentage: preview.profitPercentage,
    discount_percentage: preview.discountPercentage,
    stock_quantity: existing.stock_quantity,
    min_stock_threshold: existing.min_stock_threshold,
    // Carried through deliberately: updateProduct rewrites the whole row, so
    // dropping these would un-categorise a product, or turn an ingredient back
    // into a sellable one, on every reprice from the till.
    category_id: existing.category_id ?? null,
    kind: existing.kind || "sellable",
    stock_unit: existing.stock_unit || "unit",
    serving_qty: existing.serving_qty ?? 1,
  });

  // Emitted in addition to the catalog.product_update above, because a reprice
  // is the thing an owner actually asks about: this row carries the old price
  // next to the new one.
  // Logged when the push settles, not before: `synced_now` is not knowable
  // until then, and the reprice itself is already durable locally.
  const pushed = result.pushed.then((syncedNow) => {
    logActivity("catalog.product_reprice", {
      target: result.product.name,
      details: {
        product_id: opts.productId,
        currency,
        price_from: existing.selling_price,
        price_to: opts.sellingPrice,
        from_currency: existing.currency,
        profit_percentage: preview.profitPercentage,
        synced_now: syncedNow,
      },
    });
    return syncedNow;
  });

  return { ...result, pushed, preview };
}

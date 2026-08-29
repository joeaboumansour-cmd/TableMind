// =============================================
// Product refresh — Supabase → IndexedDB
//
// One home for "bring this store's products up to date locally".
//
// This logic used to exist twice: fetchAllProducts / fetchProductsCacheFirst in
// src/lib/supabase/client.ts, and a near-identical incremental pull inside
// SyncEngine.pullProducts. They drifted. Only one of them paginated, and the
// two could run concurrently against the same store — the page's fetch raced
// the engine's visibilitychange sync, doubling the work on the slowest screen
// in the app. Both now call refreshProductsIntoCache().
//
// MONEY: every price-bearing field travels through PRODUCT_COLUMNS and
// mapToCachedProduct below. A column missing from that list does not fail — it
// caches as `undefined` and shows up as a broken price at the till. Treat the
// two as a single unit when editing either.
// =============================================

import type { createBrowserClient } from "@supabase/ssr";
import {
  cacheProducts,
  getCachedProductsCount,
  reconcileProductsCache,
  upsertProducts,
  writeWithQuotaRescue,
} from "@/lib/db/localDB";
import type { CachedProduct } from "@/lib/db/localDB";
import type { Product } from "@/lib/types/product";

type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;

/**
 * PostgREST caps an unbounded select at max-rows (default 1000). Every product
 * query in here therefore paginates — including the delta query, which used to
 * assume "deltas are small" and silently truncated once a bulk price change
 * touched more rows than that.
 */
const PAGE_SIZE = 1000;

/**
 * How far back to rewind the incremental watermark before querying.
 *
 * The watermark is a client-side Date.now(); `updated_at` is a server-side
 * NOW(). Nothing keeps a shop phone's clock in step with Postgres, and a device
 * running even slightly fast would ask for changes "since" a moment that has
 * not happened on the server yet — permanently skipping every row written in
 * the gap. Rewinding re-fetches a few rows that were already current, which is
 * cheap and idempotent (bulkPut). Missing a price change is not.
 */
const WATERMARK_SAFETY_MS = 5 * 60 * 1000;

/**
 * The columns a cached product is built from — exactly the fields of
 * CachedProduct. Replaces `select("*")`: the table also carries columns nothing
 * reads (product_group_id), and on a ~2,300-row catalogue those ride along on
 * every page of every sync.
 */
export const PRODUCT_COLUMNS =
  "id, store_id, name, barcode, cost_price, selling_price, currency, profit_percentage, discount_percentage, stock_quantity, min_stock_threshold, category_id, kind, stock_unit, parent_id, variant_name, updated_at";

/**
 * A row as PRODUCT_COLUMNS returns it. Deliberately looser than CachedProduct:
 * Postgres nullable columns come back as null, and the mapper below is where
 * those become the defaults the app relies on.
 */
export interface ProductRow {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: string | null;
  profit_percentage: number;
  discount_percentage: number | null;
  stock_quantity: number;
  min_stock_threshold: number;
  category_id: string | null;
  kind: string | null;
  stock_unit: string | null;
  parent_id: string | null;
  variant_name: string | null;
  updated_at: string | null;
}

/** Supabase product row → CachedProduct. Single copy; was duplicated verbatim. */
export function mapToCachedProduct(p: ProductRow): CachedProduct {
  return {
    id: p.id,
    store_id: p.store_id,
    name: p.name,
    barcode: p.barcode,
    cost_price: p.cost_price,
    selling_price: p.selling_price,
    currency: p.currency || "LL",
    profit_percentage: p.profit_percentage,
    discount_percentage: p.discount_percentage || 0,
    stock_quantity: p.stock_quantity,
    min_stock_threshold: p.min_stock_threshold,
    category_id: p.category_id || null,
    // Default-sellable: a null from the DB, or a column that predates 030,
    // must read as sellable. Never invert this.
    kind: p.kind || "sellable",
    stock_unit: p.stock_unit || "unit",
    parent_id: p.parent_id || null,
    variant_name: p.variant_name || null,
    updated_at: p.updated_at || new Date().toISOString(),
  };
}

/**
 * CachedProduct -> Product, the shape the POS and cart work in.
 *
 * The inverse of mapToCachedProduct. It was written out by hand in three
 * places (twice inside the POS page's load effect alone), which is how the
 * `currency` narrowing and the `discount_percentage || 0` default came to be
 * repeated verbatim each time.
 */
export function cachedToProduct(p: CachedProduct): Product {
  return {
    id: p.id,
    store_id: p.store_id,
    name: p.name,
    barcode: p.barcode,
    cost_price: p.cost_price,
    selling_price: p.selling_price,
    currency: p.currency === "USD" ? "USD" : "LL",
    profit_percentage: p.profit_percentage,
    discount_percentage: p.discount_percentage || 0,
    stock_quantity: p.stock_quantity,
    min_stock_threshold: p.min_stock_threshold,
    category_id: p.category_id ?? null,
    kind: p.kind || "sellable",
    stock_unit: p.stock_unit || "unit",
    parent_id: p.parent_id || undefined,
    variant_name: p.variant_name || undefined,
  };
}

/**
 * Get the per-store last sync timestamp key.
 * Using per-store keys prevents Store A's sync timestamp
 * from making Store B skip network fetches.
 */
export function getLastSyncKey(storeId: string): string {
  return `products_last_sync_${storeId}`;
}

function readLastSync(storeId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      localStorage.getItem(getLastSyncKey(storeId)) ||
      localStorage.getItem("products_last_sync");
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Stamp the watermark with when the pull STARTED, not when it finished. A row
 * written while the pull was in flight may or may not have been included;
 * stamping the start time guarantees the next delta asks for it again.
 */
function writeLastSync(storeId: string, startedAt: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getLastSyncKey(storeId), startedAt.toString());
    // Also update the global key for backward compatibility
    localStorage.setItem("products_last_sync", startedAt.toString());
  } catch {}
}

// ---- Reconcile safety ----

export type ReconcileDecision =
  | { reconcile: true }
  | { reconcile: false; reason: string };

/**
 * Decide whether it is SAFE to delete cached products that are absent from a
 * fetched "live" ID set.
 *
 * Extracted as a pure function because getting this wrong is expensive:
 * reconciliation deletes from the local cache, and the cache is what keeps
 * the POS selling with no internet. An earlier implementation deleted on
 * the basis of an unpaginated query that PostgREST truncates at 1000 rows,
 * which wiped every product past that point on stores larger than the cap.
 *
 * The rule: deletion requires positive proof that the ID set is complete.
 * Anything less — an unknown live count, a failed fetch, or a count mismatch
 * suggesting truncation or a concurrent write — means skip and retry later.
 * Skipping is always safe (a stale extra product lingers one more cycle);
 * deleting on bad evidence is not.
 */
export function evaluateReconcile(params: {
  /** Products currently in the local cache for this store. */
  cachedCount: number;
  /** Server-side exact count, or null if it could not be determined. */
  liveCount: number | null;
  /** Number of IDs actually fetched, or null if the fetch failed. */
  fetchedIdCount: number | null;
}): ReconcileDecision {
  const { cachedCount, liveCount, fetchedIdCount } = params;

  if (liveCount === null) {
    return { reconcile: false, reason: "live product count unavailable" };
  }

  // A deletion always leaves the cache holding MORE than the server does.
  // If we're at or below the live count there is nothing stale to remove, so
  // we can skip the full ID sweep entirely — this is the common case.
  if (cachedCount <= liveCount) {
    return { reconcile: false, reason: "cache is not ahead of server" };
  }

  if (fetchedIdCount === null) {
    return { reconcile: false, reason: "product ID fetch failed" };
  }

  if (fetchedIdCount !== liveCount) {
    return {
      reconcile: false,
      reason: `fetched ${fetchedIdCount} IDs but store reports ${liveCount} (truncated or changed mid-fetch)`,
    };
  }

  return { reconcile: true };
}

// ---- Network reads ----

/**
 * Fetch ALL products for a store using pagination.
 * Supabase/PostgREST enforces a server-side max-rows limit (default 1000),
 * so we must paginate through all pages using .range().
 * After fetch, writes products to IndexedDB cache for instant subsequent reads.
 * Also reconciles the cache — removes any cached products that no longer
 * exist in Supabase (deleted products).
 */
export async function fetchAllProducts(
  supabase: SupabaseBrowserClient,
  storeId: string
): Promise<ProductRow[]> {
  const startedAt = Date.now();
  let allProducts: ProductRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("store_id", storeId)
      // Stable pagination: order by name THEN id. Without a unique tiebreaker
      // (id), pagination across page boundaries can skip/duplicate rows when
      // many products share the same name (e.g. "Coffee" variants).
      .order("name")
      .order("id")
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allProducts = allProducts.concat(data);
    if (data.length < PAGE_SIZE) break; // Last page

    from += PAGE_SIZE;
  }

  // Write-through cache: update IndexedDB after every successful fetch
  if (typeof window !== "undefined") {
    try {
      if (allProducts.length > 0) {
        // Quota-rescued. A full disk here used to surface as a console.warn
        // and nothing else: writeLastSync below never ran, so the watermark
        // never advanced and the app re-pulled the entire catalogue every
        // cycle, forever, while the cache silently stopped updating.
        await writeWithQuotaRescue(
          () => upsertProducts(allProducts.map(mapToCachedProduct)),
          "cache full product catalogue"
        );
      }

      // Reconcile the cache against the live product set. Without this,
      // deleted products linger in IndexedDB and reappear on refresh.
      // A full pull is by definition a complete ID set, so this is the one
      // place that can reconcile without a separate proof-of-completeness.
      await reconcileProductsCache(
        storeId,
        allProducts.map((p) => p.id)
      );

      writeLastSync(storeId, startedAt);
    } catch (e) {
      console.warn("[Products] Failed to write-through cache:", e);
    }
  }

  return allProducts;
}

/**
 * Fetch the complete set of product IDs for a store.
 *
 * CRITICAL: this MUST paginate. PostgREST caps an unbounded select at
 * max-rows (default 1000). A truncated ID list fed to
 * reconcileProductsCache() reads as "everything past row 1000 was deleted"
 * and wipes those products from the local cache — which the next sync then
 * re-pulls, producing a permanent delete/refetch thrash loop.
 *
 * Returns null if the ID set could not be proven complete, so callers can
 * skip reconciliation rather than delete on incomplete information.
 */
export async function fetchAllProductIds(
  supabase: SupabaseBrowserClient,
  storeId: string
): Promise<string[] | null> {
  const ids: string[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("products")
      .select("id")
      // Order by the primary key — unique, so pages can't skip or duplicate.
      .order("id")
      .eq("store_id", storeId)
      .range(from, to);

    if (error) {
      console.warn("[Products] Product ID pagination failed:", error);
      return null;
    }
    if (!data || data.length === 0) break;

    for (const row of data) ids.push((row as { id: string }).id);
    if (data.length < PAGE_SIZE) break; // Last page

    from += PAGE_SIZE;
  }

  return ids;
}

/**
 * Products changed since `sinceIso`.
 *
 * Paginated, unlike the version this replaces. A bulk price change across a
 * 2,300-product catalogue produces a delta far larger than the 1000-row cap;
 * the old single-shot query returned the first 1000 and reported success,
 * leaving the rest of the store priced from stale cache until something forced
 * a full pull.
 *
 * Ordered by updated_at THEN id: updated_at alone is not unique (a bulk write
 * stamps hundreds of rows in the same transaction, at the same NOW()), and
 * without a unique tiebreaker pages can skip or repeat rows.
 */
async function fetchProductsUpdatedSince(
  supabase: SupabaseBrowserClient,
  storeId: string,
  sinceIso: string
): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("store_id", storeId)
      .gte("updated_at", sinceIso)
      .order("updated_at")
      .order("id")
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return rows;
}

/** Server-side exact product count, or null if it could not be determined. */
async function fetchLiveProductCount(
  supabase: SupabaseBrowserClient,
  storeId: string
): Promise<number | null> {
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId);

  if (error || count === null || count === undefined) return null;
  return count;
}

/**
 * Remove cached products that no longer exist on the server — but only on
 * positive proof that the fetched ID set is complete. See evaluateReconcile.
 * Returns how many rows were removed.
 */
async function reconcileIfSafe(
  supabase: SupabaseBrowserClient,
  storeId: string,
  liveCount: number | null
): Promise<number> {
  try {
    const cachedCount = await getCachedProductsCount(storeId);

    // Cheap pre-check: only pay for the full ID sweep when the cache is
    // actually ahead of the server, i.e. something may have been deleted.
    const preCheck = evaluateReconcile({
      cachedCount,
      liveCount,
      fetchedIdCount: null,
    });

    if (!preCheck.reconcile && preCheck.reason === "cache is not ahead of server") {
      return 0; // Nothing stale to remove — skip without fetching any IDs.
    }
    if (liveCount === null) {
      console.warn(
        `[Products] Skipping reconcile — ${preCheck.reconcile ? "" : preCheck.reason}`
      );
      return 0;
    }

    const liveIds = await fetchAllProductIds(supabase, storeId);
    const decision = evaluateReconcile({
      cachedCount,
      liveCount,
      fetchedIdCount: liveIds === null ? null : liveIds.length,
    });

    if (!decision.reconcile || !liveIds) {
      if (!decision.reconcile) {
        console.warn(`[Products] Skipping reconcile — ${decision.reason}`);
      }
      return 0;
    }

    const removed = await reconcileProductsCache(storeId, liveIds);
    if (removed > 0) {
      console.log(`[Products] Reconcile removed ${removed} deleted products from cache`);
    }
    return removed;
  } catch (e) {
    console.warn("[Products] Cache reconciliation failed (non-fatal):", e);
    return 0;
  }
}

// ---- The one entry point ----

export interface RefreshResult {
  mode: "delta" | "full";
  /** True if the local cache actually moved. Callers use this to skip a re-render. */
  changed: boolean;
  /** Rows written to the cache. */
  count: number;
  /** Rows removed by reconciliation. */
  removed: number;
}

/**
 * How close together two calls have to be to count as "the same question".
 *
 * Entering the inventory screen also wakes the sync engine's visibilitychange
 * handler, so two refreshes fire within a tick of each other and should share
 * one network round-trip.
 */
const JOIN_WINDOW_MS = 250;

interface InFlightRun {
  startedAt: number;
  promise: Promise<RefreshResult>;
}

/** At most one running refresh per store. */
const inFlight = new Map<string, InFlightRun>();

/**
 * Bring the local product cache up to date with Supabase.
 *
 * Incremental where possible (an `updated_at` watermark, backed by
 * idx_products_store_updated), full pull on first sync or whenever the cache is
 * demonstrably short of the server's row count. Deletions are caught by the
 * count + reconcile guard, because products are hard-deleted — there is no
 * deleted_at column for a delta to carry.
 *
 * Concurrency: callers arriving together share one run. A caller arriving
 * later is queued BEHIND the running one rather than joining it — it may be
 * refreshing precisely because it just wrote a product, and a query issued
 * before that write cannot answer for it. Either way there is never more than
 * one product pull in flight for a store.
 *
 * Throws on network failure; callers decide whether that is fatal.
 */
export function refreshProductsIntoCache(
  supabase: SupabaseBrowserClient,
  storeId: string
): Promise<RefreshResult> {
  const current = inFlight.get(storeId);

  if (current && Date.now() - current.startedAt < JOIN_WINDOW_MS) {
    return current.promise;
  }

  const promise = (current ? current.promise.catch(() => undefined) : Promise.resolve()).then(
    () => runRefresh(supabase, storeId)
  );

  const entry: InFlightRun = { startedAt: Date.now(), promise };
  inFlight.set(storeId, entry);

  return promise.finally(() => {
    // Only clear the slot if a later caller has not already replaced it.
    if (inFlight.get(storeId) === entry) inFlight.delete(storeId);
  });
}

async function runRefresh(
  supabase: SupabaseBrowserClient,
  storeId: string
): Promise<RefreshResult> {
  const startedAt = Date.now();
  const lastSync = readLastSync(storeId);

  // No watermark — nothing to be incremental about.
  if (lastSync === null) {
    const all = await fetchAllProducts(supabase, storeId);
    return { mode: "full", changed: true, count: all.length, removed: 0 };
  }

  const sinceIso = new Date(Math.max(0, lastSync - WATERMARK_SAFETY_MS)).toISOString();
  const changedRows = await fetchProductsUpdatedSince(supabase, storeId, sinceIso);

  // The delta only carries rows that changed. If the cache is missing products
  // for any other reason — a partial first fetch, seed data, a cleared DB — no
  // number of deltas will ever fill the gap, so compare against the real count.
  const liveCount = await fetchLiveProductCount(supabase, storeId);
  if (liveCount !== null) {
    const cachedCount = await getCachedProductsCount(storeId);
    if (cachedCount < liveCount) {
      console.log(
        `[Products] Cache has ${cachedCount} of ${liveCount} products — doing full pull`
      );
      const all = await fetchAllProducts(supabase, storeId);
      return { mode: "full", changed: true, count: all.length, removed: 0 };
    }
  }

  if (changedRows.length > 0) {
    await writeWithQuotaRescue(
      () => cacheProducts(changedRows.map(mapToCachedProduct)),
      "cache product delta"
    );
    console.log(`[Products] Delta pull applied ${changedRows.length} changed products`);
  }

  const removed = await reconcileIfSafe(supabase, storeId, liveCount);

  writeLastSync(storeId, startedAt);

  return {
    mode: "delta",
    changed: changedRows.length > 0 || removed > 0,
    count: changedRows.length,
    removed,
  };
}

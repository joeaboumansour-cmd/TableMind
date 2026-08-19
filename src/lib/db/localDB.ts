// ===
// Local IndexedDB Database (Dexie.js)
// Caches products and queues offline transactions
// ===

import Dexie, { type EntityTable } from "dexie";

// ---- Types ----

export interface CachedTransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
}

export interface CachedTransaction {
  id: string;
  store_id: string;
  transaction_number: string;
  receipt_token?: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  created_at: string;
  user_id?: string;
  user_name?: string;
  transaction_items: CachedTransactionItem[];
}

export interface CachedProduct {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: string;
  profit_percentage: number;
  discount_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  parent_id?: string | null;
  variant_name?: string | null;
  updated_at: string;
}

export interface QueuedTransaction {
  id: string;
  store_id: string;
  transaction_number: string;
  receipt_token?: string;
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  payment_method: string;
  subtotal_usd: number;
  total_usd: number;
  amount_paid_usd: number;
  change_given_usd: number;
  user_id?: string;
  user_name?: string;
  items: QueuedTransactionItem[];
  created_at: string;
  /** Sync attempts so far. Absent on rows queued before this field existed. */
  retry_count?: number;
  /** Message from the most recent failed sync attempt. */
  last_error?: string | null;
  /**
   * Set once the retry cap is exhausted. A dead-lettered sale is NEVER deleted
   * — it is real money that failed to reach the server — it is only excluded
   * from the automatic retry loop so it stops burning requests, and surfaced
   * to the user for manual resolution.
   */
  failed_permanently?: boolean;
}

export interface QueuedTransactionItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  unit_price_usd: number;
  total_price_usd: number;
}

export interface PendingWrite {
  id: string;
  type: "transaction" | "stock_decrement" | "favorite_add" | "favorite_remove" | "cash_shift_open" | "cash_shift_close" | "cash_adjustment";
  payload: unknown;
  created_at: string;
  retry_count: number;
  last_error: string | null;
}

// ---- Database ----

const db = new Dexie("GoldenSquirrelPOS") as Dexie & {
  products_cache: EntityTable<CachedProduct, "id">;
  transactions_cache: EntityTable<CachedTransaction, "id">;
  offline_queue: EntityTable<QueuedTransaction, "id">;
  pending_writes: EntityTable<PendingWrite, "id">;
};

// Database version 1: initial schema
db.version(1).stores({
  // Products cache - mirrored from Supabase
  products_cache:
    "id, store_id, name, barcode, updated_at",

  // Offline transactions waiting to be synced
  offline_queue:
    "id, store_id, created_at",

  // Pending writes (generic fallback for other operations)
  pending_writes:
    "id, type, created_at, retry_count",
});

// Database version 2: add transactions history cache
db.version(2).stores({
  products_cache:
    "id, store_id, name, barcode, updated_at",
  transactions_cache:
    "id, store_id, transaction_number, created_at",
  offline_queue:
    "id, store_id, created_at",
  pending_writes:
    "id, type, created_at, retry_count",
});

// Database version 3: compound indexes.
// Every index above is single-key, which forced two bad patterns:
//   - barcode lookups could not be store-scoped at the index level, so a
//     device that has served two stores could return the wrong store's
//     product on a scan (tenancy rule, CLAUDE.md §1)
//   - transaction history had to be sorted in JS via .sortBy() because there
//     was no [store_id+created_at] index for Dexie to sort on
// Dexie migrations are additive: existing rows are preserved and reindexed.
db.version(3).stores({
  products_cache:
    "id, store_id, name, barcode, updated_at, [store_id+barcode], [store_id+name]",
  transactions_cache:
    "id, store_id, transaction_number, created_at, [store_id+created_at]",
  offline_queue:
    "id, store_id, created_at",
  pending_writes:
    "id, type, created_at, retry_count",
});

// ---- Products Cache Operations ----

/**
 * Upsert products into the local cache using Dexie's bulkPut.
 * This is an incremental update — it inserts new products and updates
 * existing ones by ID without clearing the entire cache first.
 * Much faster than clear() + bulkAdd() for large datasets.
 */
export async function upsertProducts(products: CachedProduct[]): Promise<void> {
  if (products.length === 0) return;
  await db.products_cache.bulkPut(products);
  console.log(`[LocalDB] Upserted ${products.length} products`);
}

/**
 * Legacy alias — kept for backward compatibility.
 * Use upsertProducts() instead for better performance.
 */
export async function cacheProducts(products: CachedProduct[]): Promise<void> {
  await upsertProducts(products);
}

/**
 * Upsert a single product into the local cache.
 * Used by barcode scan fallback to avoid clearing the entire cache.
 */
export async function upsertSingleProduct(product: CachedProduct): Promise<void> {
  await db.products_cache.put(product);
  console.log(`[LocalDB] Upserted single product: ${product.name} (${product.id})`);
}

/**
 * Remove specific products from the local cache by ID.
 * Critical for deletion sync — without this, deleted products
 * linger in IndexedDB and reappear on refresh.
 */
export async function removeCachedProducts(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  await db.products_cache.bulkDelete(productIds);
  console.log(`[LocalDB] Removed ${productIds.length} products from cache`);
}

/**
 * Remove a single product from the local cache by ID.
 */
export async function removeCachedProduct(productId: string): Promise<void> {
  await db.products_cache.delete(productId);
  console.log(`[LocalDB] Removed product ${productId} from cache`);
}

/**
 * Reconcile the cache against a set of "live" product IDs from Supabase.
 * Any cached product for this store NOT in the live set is deleted.
 * This is the ONLY reliable way to detect deletions in the cache.
 */
export async function reconcileProductsCache(
  storeId: string,
  liveProductIds: string[]
): Promise<number> {
  const liveSet = new Set(liveProductIds);
  const cached = await db.products_cache
    .where("store_id")
    .equals(storeId)
    .toArray();

  const staleIds = cached
    .filter((p) => !liveSet.has(p.id))
    .map((p) => p.id);

  if (staleIds.length > 0) {
    await db.products_cache.bulkDelete(staleIds);
    console.log(`[LocalDB] Reconcile: removed ${staleIds.length} stale products for store ${storeId}`);
  }

  return staleIds.length;
}

export async function getCachedProducts(storeId: string): Promise<CachedProduct[]> {
  return db.products_cache
    .where("store_id")
    .equals(storeId)
    .toArray();
}

/**
 * Cached products for a store, ordered by name — the same order the server
 * returns them in (`.order("name").order("id")`).
 *
 * getCachedProducts() above returns primary-key order, which is arbitrary to a
 * reader. That is fine for a lookup and wrong for a first paint: the inventory
 * list would render in one order and visibly reshuffle a moment later when the
 * ordered server rows landed. Reads through the [store_id+name] compound index,
 * so the ordering costs nothing extra.
 */
export async function getCachedProductsSortedByName(
  storeId: string
): Promise<CachedProduct[]> {
  return db.products_cache
    .where("[store_id+name]")
    .between([storeId, Dexie.minKey], [storeId, Dexie.maxKey])
    .toArray();
}

/**
 * Look up a cached product by barcode WITHIN a store.
 *
 * The store_id argument is required. Barcodes are not unique across stores,
 * and this previously queried barcode alone — so on a device that had served
 * more than one store, a scan could return another store's product (and
 * therefore another store's price). Uses the [store_id+barcode] compound
 * index added in schema v3.
 */
export async function getCachedProductByBarcode(
  barcode: string,
  storeId: string
): Promise<CachedProduct | undefined> {
  if (!storeId) return undefined;
  return db.products_cache
    .where("[store_id+barcode]")
    .equals([storeId, barcode])
    .first();
}

export async function getCachedProductById(
  id: string
): Promise<CachedProduct | undefined> {
  return db.products_cache.get(id);
}

/**
 * Decrement stock for specific products in the local cache.
 * This gives INSTANT feedback after a transaction completes, without
 * waiting for the next network sync (which may be delayed up to 5 minutes
 * by the cache-freshness window).
 */
export async function decrementCachedStock(
  items: Array<{ product_id: string; quantity: number }>
): Promise<void> {
  if (items.length === 0) return;

  // One IndexedDB transaction for the whole cart, not one per line item.
  // This also makes the decrement atomic — a mid-loop failure can no longer
  // leave some products decremented and others not.
  await db.transaction("rw", db.products_cache, async () => {
    for (const item of items) {
      await db.products_cache
        .where("id")
        .equals(item.product_id)
        .modify((p) => {
          p.stock_quantity = (p.stock_quantity || 0) - item.quantity;
        });
    }
  });
  console.log(`[LocalDB] Decremented cached stock for ${items.length} products`);
}

/**
 * Count cached products for a specific store.
 * If storeId is provided, only counts products for that store.
 * If omitted, counts ALL cached products (legacy behavior).
 */
export async function getCachedProductsCount(storeId?: string): Promise<number> {
  if (storeId) {
    return db.products_cache
      .where("store_id")
      .equals(storeId)
      .count();
  }
  return db.products_cache.count();
}

// ---- Transactions Cache Operations ----

/**
 * Replace the cached transaction history for ONE store.
 *
 * Two things this had wrong before: it called .clear(), which wiped every
 * store's cached history rather than just this one, and the clear/insert pair
 * was not wrapped in a transaction — so a failure between them left the cache
 * empty. Both are fixed here; the store id is taken from the rows themselves.
 */
export async function cacheTransactions(transactions: CachedTransaction[]): Promise<void> {
  const storeIds = [...new Set(transactions.map((t) => t.store_id))];

  await db.transaction("rw", db.transactions_cache, async () => {
    if (storeIds.length > 0) {
      // Scoped delete — leave other stores' cached history intact.
      await db.transactions_cache.where("store_id").anyOf(storeIds).delete();
    }
    await db.transactions_cache.bulkPut(transactions);
  });
  console.log(`[LocalDB] Cached ${transactions.length} transactions`);
}

export async function getCachedTransactions(storeId: string): Promise<CachedTransaction[]> {
  // Sorts on the [store_id+created_at] index (schema v3) rather than pulling
  // every row into memory for a JS sort, which is what .sortBy() did.
  return db.transactions_cache
    .where("[store_id+created_at]")
    .between([storeId, Dexie.minKey], [storeId, Dexie.maxKey])
    .reverse()
    .toArray();
}

export async function getCachedTransactionsCount(): Promise<number> {
  return db.transactions_cache.count();
}

// ---- Offline Queue Operations ----

export async function queueTransaction(
  transaction: QueuedTransaction
): Promise<void> {
  await db.offline_queue.add(transaction);
  console.log(`[LocalDB] Queued transaction ${transaction.transaction_number} for sync`);
}

/**
 * Transactions eligible for a sync attempt, oldest first.
 * Excludes dead-lettered rows so a permanently-rejected sale stops consuming
 * a network request every 30 seconds. Use getDeadLetterTransactions() to
 * surface those to the user.
 */
export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  const all = await db.offline_queue.orderBy("created_at").toArray();
  return all.filter((t) => !t.failed_permanently);
}

/**
 * Sales that exhausted their retry budget and need manual attention.
 * These are never auto-deleted — each one is a completed sale whose money
 * was taken but which never reached the server.
 */
export async function getDeadLetterTransactions(): Promise<QueuedTransaction[]> {
  const all = await db.offline_queue.orderBy("created_at").toArray();
  return all.filter((t) => t.failed_permanently === true);
}

/**
 * Record a failed sync attempt. Returns the new retry count.
 * Once `maxRetries` is reached the row is dead-lettered rather than deleted.
 */
export async function recordQueuedTransactionFailure(
  id: string,
  error: string,
  maxRetries: number
): Promise<number> {
  let count = 0;
  await db.transaction("rw", db.offline_queue, async () => {
    const txn = await db.offline_queue.get(id);
    if (!txn) return;
    count = (txn.retry_count || 0) + 1;
    await db.offline_queue.update(id, {
      retry_count: count,
      last_error: error,
      failed_permanently: count >= maxRetries,
    });
  });
  return count;
}

export async function removeQueuedTransaction(
  id: string
): Promise<void> {
  await db.offline_queue.delete(id);
}

/** Count of transactions still awaiting a sync attempt (excludes dead-lettered). */
export async function getQueuedCount(): Promise<number> {
  return (await getQueuedTransactions()).length;
}

/** Count of sales that failed permanently and need manual attention. */
export async function getDeadLetterCount(): Promise<number> {
  return (await getDeadLetterTransactions()).length;
}

// ---- Pending Writes Operations ----

export async function addPendingWrite(write: PendingWrite): Promise<void> {
  await db.pending_writes.add(write);
}

export async function getPendingWrites(): Promise<PendingWrite[]> {
  return db.pending_writes
    .orderBy("created_at")
    .toArray();
}

/**
 * Pending writes of a single type, oldest first.
 * `type` is indexed, so this beats reading the whole table and filtering in
 * JS — which is what every caller was doing.
 */
export async function getPendingWritesByType(
  type: PendingWrite["type"]
): Promise<PendingWrite[]> {
  const rows = await db.pending_writes.where("type").equals(type).toArray();
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removePendingWrite(id: string): Promise<void> {
  await db.pending_writes.delete(id);
}

// ---- Database Maintenance ----

export async function clearAllData(): Promise<void> {
  await db.products_cache.clear();
  await db.transactions_cache.clear();
  await db.offline_queue.clear();
  await db.pending_writes.clear();
  console.log("[LocalDB] Cleared all local data");
}

export async function getLocalDBSize(): Promise<{
  products: number;
  transactions_cache: number;
  queued_transactions: number;
  pending_writes: number;
}> {
  return {
    products: await db.products_cache.count(),
    transactions_cache: await db.transactions_cache.count(),
    queued_transactions: await db.offline_queue.count(),
    pending_writes: await db.pending_writes.count(),
  };
}

// ---- Seed Products (for first-time offline use) ----

export interface SeedProduct {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: string;
  profit_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  parent_id?: string | null;
  variant_name?: string | null;
  updated_at: string;
}

/**
 * Fetch seed products from the static JSON file.
 * These are bundled with the app so they're available even on first launch with no internet.
 */
export async function fetchSeedProducts(): Promise<SeedProduct[]> {
  try {
    const response = await fetch("/seed-products.json", {
      cache: "force-cache",
    });
    if (!response.ok) {
      console.warn("[LocalDB] Failed to fetch seed products:", response.status);
      return [];
    }
    const data = await response.json();
    return data as SeedProduct[];
  } catch (error) {
    console.warn("[LocalDB] Error fetching seed products:", error);
    return [];
  }
}

/**
 * Seed the local cache with default products if the cache is empty for a given store.
 * This ensures the app is usable on first launch even without an online session.
 * The seed products use store_id "seed" — they are remapped to the actual store_id.
 */
export async function seedProductsIfNeeded(storeId: string): Promise<number> {
  try {
    // Check if we already have cached products for this store
    const existing = await getCachedProducts(storeId);
    if (existing.length > 0) {
      return 0; // Already have products, no seeding needed
    }

    // Also check if we have ANY products cached for THIS store
    // (not any store — per-store isolation)
    const storeCount = await getCachedProductsCount(storeId);
    if (storeCount > 0) {
      return 0; // We have products for this store, don't seed
    }

    // Fetch seed products from static JSON
    const seedProducts = await fetchSeedProducts();
    if (seedProducts.length === 0) {
      console.warn("[LocalDB] No seed products available to cache");
      return 0;
    }

    // Remap seed products to the actual store_id
    const mappedProducts: CachedProduct[] = seedProducts.map((p) => ({
      id: p.id,
      store_id: storeId,
      name: p.name,
      barcode: p.barcode,
      cost_price: p.cost_price,
      selling_price: p.selling_price,
      currency: p.currency,
      profit_percentage: p.profit_percentage,
      discount_percentage: (p as any).discount_percentage || 0,
      stock_quantity: p.stock_quantity,
      min_stock_threshold: p.min_stock_threshold,
      parent_id: p.parent_id || null,
      variant_name: p.variant_name || null,
      updated_at: p.updated_at,
    }));

    await cacheProducts(mappedProducts);
    console.log(`[LocalDB] Seeded ${mappedProducts.length} default products for store ${storeId}`);
    return mappedProducts.length;
  } catch (error) {
    console.error("[LocalDB] Error seeding products:", error);
    return 0;
  }
}

// ---- Stock Decrement Queuing ----

/**
 * Queue a stock decrement for later sync.
 * This ensures stock is decremented even if the user goes offline
 * between transaction creation and sync.
 *
 * NOTE: This is now ONLY used for offline transactions. Online transactions
 * decrement stock server-side in the /api/transactions route.
 */
export async function queueStockDecrement(
  productId: string,
  quantity: number,
  storeId: string
): Promise<void> {
  const pendingWrite: PendingWrite = {
    id: crypto.randomUUID(),
    type: "stock_decrement",
    payload: {
      product_id: productId,
      quantity: quantity,
      store_id: storeId,
    },
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  };
  await db.pending_writes.add(pendingWrite);
  console.log(`[LocalDB] Queued stock decrement for product ${productId} (qty: ${quantity})`);
}

/**
 * Queue stock decrements for all items in a transaction.
 * Called when a transaction is created offline.
 */
export async function queueStockDecrementsForTransaction(
  items: Array<{ product_id: string; quantity: number }>,
  storeId: string
): Promise<void> {
  for (const item of items) {
    await queueStockDecrement(item.product_id, item.quantity, storeId);
  }
}

// ---- Cash Shift Queuing ----

export interface CashShiftOpenPayload {
  store_id: string;
  business_date: string;
  opening_ll: number;
  opening_usd: number;
  user_id?: string;
  user_name?: string;
}

export interface CashShiftClosePayload {
  shift_id: string;
  store_id: string;
  closing_ll: number;
  closing_usd: number;
  notes?: string;
  user_id?: string;
  user_name?: string;
}

export interface CashAdjustmentPayload {
  store_id: string;
  shift_id: string;
  adjustment_type: "cash_in" | "cash_out";
  amount_ll: number;
  amount_usd: number;
  reason: string;
  user_id?: string;
  user_name?: string;
}

/**
 * Queue a cash shift open operation for later sync when offline.
 */
export async function queueCashShiftOpen(payload: CashShiftOpenPayload): Promise<void> {
  const pendingWrite: PendingWrite = {
    id: crypto.randomUUID(),
    type: "cash_shift_open",
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  };
  await db.pending_writes.add(pendingWrite);
  console.log(`[LocalDB] Queued cash shift open for ${payload.business_date}`);
}

/**
 * Queue a cash shift close operation for later sync when offline.
 */
export async function queueCashShiftClose(payload: CashShiftClosePayload): Promise<void> {
  const pendingWrite: PendingWrite = {
    id: crypto.randomUUID(),
    type: "cash_shift_close",
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  };
  await db.pending_writes.add(pendingWrite);
  console.log(`[LocalDB] Queued cash shift close for shift ${payload.shift_id}`);
}

/**
 * Queue a cash adjustment operation for later sync when offline.
 */
export async function queueCashAdjustment(payload: CashAdjustmentPayload): Promise<void> {
  const pendingWrite: PendingWrite = {
    id: crypto.randomUUID(),
    type: "cash_adjustment",
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  };
  await db.pending_writes.add(pendingWrite);
  console.log(`[LocalDB] Queued cash adjustment for shift ${payload.shift_id}`);
}

export { db as localDB };
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
  subtotal: number;
  total_amount: number;
  amount_paid: number;
  change_given: number;
  created_at: string;
  whatsapp_sent_to?: string;
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
  whatsapp_sent_to?: string;
  items: QueuedTransactionItem[];
  created_at: string;
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
  type: "transaction" | "stock_decrement";
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

// ---- Products Cache Operations ----

export async function cacheProducts(products: CachedProduct[]): Promise<void> {
  await db.products_cache.clear();
  await db.products_cache.bulkAdd(products);
  console.log(`[LocalDB] Cached ${products.length} products`);
}

export async function getCachedProducts(storeId: string): Promise<CachedProduct[]> {
  return db.products_cache
    .where("store_id")
    .equals(storeId)
    .toArray();
}

export async function getCachedProductByBarcode(
  barcode: string
): Promise<CachedProduct | undefined> {
  return db.products_cache
    .where("barcode")
    .equals(barcode)
    .first();
}

export async function getCachedProductById(
  id: string
): Promise<CachedProduct | undefined> {
  return db.products_cache.get(id);
}

export async function getCachedProductsCount(): Promise<number> {
  return db.products_cache.count();
}

// ---- Transactions Cache Operations ----

export async function cacheTransactions(transactions: CachedTransaction[]): Promise<void> {
  await db.transactions_cache.clear();
  await db.transactions_cache.bulkAdd(transactions);
  console.log(`[LocalDB] Cached ${transactions.length} transactions`);
}

export async function getCachedTransactions(storeId: string): Promise<CachedTransaction[]> {
  return db.transactions_cache
    .where("store_id")
    .equals(storeId)
    .reverse()
    .sortBy("created_at");
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

export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  return db.offline_queue
    .orderBy("created_at")
    .toArray();
}

export async function removeQueuedTransaction(
  id: string
): Promise<void> {
  await db.offline_queue.delete(id);
}

export async function getQueuedCount(): Promise<number> {
  return db.offline_queue.count();
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

    // Also check if we have ANY products cached (from any store)
    const totalCount = await getCachedProductsCount();
    if (totalCount > 0) {
      return 0; // We have some products, don't seed
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
 * Called when a transaction is created (both online and offline).
 */
export async function queueStockDecrementsForTransaction(
  items: Array<{ product_id: string; quantity: number }>,
  storeId: string
): Promise<void> {
  for (const item of items) {
    await queueStockDecrement(item.product_id, item.quantity, storeId);
  }
}

export { db as localDB };


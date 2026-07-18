// =============================================
// Local IndexedDB Database (Dexie.js)
// Caches products and queues offline transactions
// =============================================

import Dexie, { type EntityTable } from "dexie";

// ---- Types ----

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
  await db.offline_queue.clear();
  await db.pending_writes.clear();
  console.log("[LocalDB] Cleared all local data");
}

export async function getLocalDBSize(): Promise<{
  products: number;
  queued_transactions: number;
  pending_writes: number;
}> {
  return {
    products: await db.products_cache.count(),
    queued_transactions: await db.offline_queue.count(),
    pending_writes: await db.pending_writes.count(),
  };
}

export { db as localDB };
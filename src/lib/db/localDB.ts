// ===
// Local IndexedDB Database (Dexie.js)
// Caches products and queues offline transactions
// ===

import Dexie, { type EntityTable } from "dexie";
import type { CartLineComboChild, CartLineModifier } from "@/lib/types/cart";
import type { StockDecrement } from "@/lib/pos/lineItems";

// ---- Types ----

export interface CachedTransactionItem {
  id: string;
  /**
   * The join key to products_cache, and the reason Profit works offline.
   *
   * Without it, History could compute revenue, item counts and averages
   * on-device but had to show "—" for Profit, because cost_price lives on the
   * product and there was no way to get from a sold line back to its product.
   * Optional because rows cached before this field existed will not have it;
   * computeProfit() falls back to the line's unit_price in that case.
   */
  product_id?: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  /**
   * Made-to-order choices as sold. Optional, like product_id above: rows
   * cached before this field existed will not have it, and null is correct
   * for every ordinary line anyway.
   */
  modifiers?: CartLineModifier[] | null;
  /** Free-text instruction for this line. Optional, like modifiers above. */
  note?: string | null;
  /** What a combo contained. Optional, for the same reason. */
  combo_children?: CartLineComboChild[] | null;
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
  /**
   * product_categories.id. OPTIONAL because rows cached by a build from
   * before categories existed do not have it — treat `undefined` as
   * "uncategorised", never as a reason to hide the product.
   */
  category_id?: string | null;
  /**
   * 'sellable' | 'ingredient'. OPTIONAL: rows cached before migration 030 do
   * not have it. undefined MUST read as sellable — see lib/products/kind.ts.
   */
  kind?: string | null;
  /** Unit for stock_quantity. Optional for the same reason as `kind`. */
  stock_unit?: string | null;
  /** One portion of this ingredient, in its stock_unit. Defaults to 1. */
  serving_qty?: number | null;
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
  /**
   * What this sale takes out of stock, computed at CHECKOUT time.
   *
   * ⚠️ This field is why an offline menu sale deducts the right thing.
   *
   * The server falls back to deriving decrements from `items` when this is
   * absent — correct for every ordinary sale and for every row queued before
   * this existed. But for a MENU line, `items` names the sandwich, so that
   * fallback would decrement the sandwich instead of its ingredients: silent,
   * offline-only, and invisible until a stock take.
   *
   * Computed here rather than on the server on purpose: the recipe AT THE TIME
   * OF SALE is the right recipe. A sandwich sold offline on Monday and synced
   * on Wednesday must deduct what Monday's recipe said, not what the owner
   * changed it to on Tuesday.
   */
  stock_decrements?: StockDecrement[];
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
  /**
   * Earliest time this row should be attempted again, as an ISO string.
   * Absent means "attempt immediately", which is what every row queued before
   * this field existed will do.
   *
   * Retries used to have no delay at all: retry_count was incremented and the
   * row was tried again on the very next 30s cycle, at full speed, forever.
   * See computeRetryBackoffMs().
   *
   * Deliberately NOT indexed. Adding an index means a Dexie version bump, and
   * getQueuedTransactions() already reads the whole table and filters in JS —
   * so an index would buy nothing today. When that scan is fixed, index this
   * at the same time.
   */
  next_attempt_at?: string;
}

export interface QueuedTransactionItem {
  /**
   * NULL for a one-off line — something sold once that has no catalogue row
   * behind it. transaction_items.product_id is a nullable FK, and the
   * transactions API already skips the stock decrement when it is absent.
   * The mapping from the cart's synthetic key to null happens in exactly one
   * place: src/lib/pos/lineItems.ts.
   */
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  unit_price_usd: number;
  total_price_usd: number;
  /**
   * Made-to-order choices as sold. NULL = an ordinary line; [] = a menu line
   * with nothing changed. Mirrors SaleLineItem exactly so the online and
   * offline payloads cannot disagree.
   */
  modifiers?: CartLineModifier[] | null;
  /** Free-text instruction for this line. Mirrors SaleLineItem. */
  note?: string | null;
  /** What a combo line contains. Mirrors SaleLineItem. */
  combo_children?: CartLineComboChild[] | null;
}

export interface PendingWrite {
  id: string;
  type: "transaction" | "stock_decrement" | "favorite_add" | "favorite_remove" | "cash_shift_open" | "cash_shift_close" | "cash_adjustment" | "product_upsert" | "register_create";
  payload: unknown;
  created_at: string;
  retry_count: number;
  last_error: string | null;
  /** See QueuedTransaction.next_attempt_at. */
  next_attempt_at?: string;
  /**
   * Set when the server rejected this write in a way retrying cannot fix (a
   * 4xx). The row is KEPT, not deleted: it is the only record that the local
   * data and the server disagree, and it is what stops
   * reconcileProductsCache() from wiping the product it refers to.
   */
  failed_permanently?: boolean;
}

/**
 * One activity event waiting to be shipped to /api/activity.
 *
 * `seq` is a Dexie auto-increment key, which makes the buffer a strict FIFO:
 * draining and trimming both work in insertion order without needing to sort.
 * The event carries its own `occurred_at`, so a buffered event keeps the time
 * it actually happened rather than the time it was flushed.
 */
export interface BufferedActivityEvent {
  seq?: number;
  occurred_at: string;
  /** An ActivityEvent. Typed as unknown here so localDB stays free of activity imports. */
  event: unknown;
}

// ---- Database ----

const db = new Dexie("GoldenSquirrelPOS") as Dexie & {
  products_cache: EntityTable<CachedProduct, "id">;
  transactions_cache: EntityTable<CachedTransaction, "id">;
  offline_queue: EntityTable<QueuedTransaction, "id">;
  pending_writes: EntityTable<PendingWrite, "id">;
  activity_buffer: EntityTable<BufferedActivityEvent, "seq">;
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

// Database version 4: the activity buffer.
//
// This is a NEW top-level table rather than another PendingWrite type, and the
// offline-write skill discourages that — so, the reasons:
//   - pending_writes is read WHOLE by getPendingWrites() on every 30s sync
//     cycle, on the money path. A day of buffered UI events would make that
//     scan expensive for no benefit to the thing it exists to protect.
//   - the retry semantics are inverted. A pending write is retried and then
//     dead-lettered because it represents something the server must eventually
//     learn. A log event that will not send is simply dropped.
//   - the storage priority is inverted too: this buffer is the FIRST thing
//     sacrificed under disk pressure, ahead of transactions_cache.
// Keeping it separate is what stops any of that leaking into the sale path.
db.version(4).stores({
  products_cache:
    "id, store_id, name, barcode, updated_at, [store_id+barcode], [store_id+name]",
  transactions_cache:
    "id, store_id, transaction_number, created_at, [store_id+created_at]",
  offline_queue:
    "id, store_id, created_at",
  pending_writes:
    "id, type, created_at, retry_count",
  activity_buffer:
    "++seq, occurred_at",
});

// ---- Storage Pressure ----

/**
 * Thrown when a write could not be made to fit even after sacrificing every
 * expendable cache. Distinct from a generic failure so the UI can say
 * something true and actionable instead of "Failed to end transaction".
 */
export class StorageFullError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "StorageFullError";
  }
}

/**
 * Is this the browser telling us the disk is full?
 *
 * Spelled differently per engine: Chrome/Safari throw a DOMException named
 * QuotaExceededError, Firefox has historically used NS_ERROR_DOM_QUOTA_REACHED,
 * and legacy code paths only set the numeric code 22. Dexie also wraps some
 * failures, so the inner error is checked too.
 */
function isQuotaError(e: unknown): boolean {
  type ErrorLike = {
    name?: unknown;
    code?: unknown;
    inner?: unknown;
    cause?: unknown;
  };

  const seen = new Set<unknown>();
  let err: unknown = e;

  while (err && typeof err === "object" && !seen.has(err)) {
    seen.add(err);
    const { name, code, inner, cause } = err as ErrorLike;
    if (
      name === "QuotaExceededError" ||
      name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      name === "QuotaExceeded" ||
      code === 22 ||
      code === 1014
    ) {
      return true;
    }
    err = inner ?? cause;
  }
  return false;
}

/**
 * The eviction order, as DATA so it can be asserted rather than read.
 *
 * Order matters and so does absence. Phase 6.2 asks for this to be formalised
 * and for "queued sales are never shed" to be *asserted* — a comment saying so
 * is exactly what a future edit does not have to read.
 *
 * `products_cache` is deliberately NOT here, and the plan's own suggested order
 * ("activity buffer → transaction history cache → product cache") is declined
 * on purpose: it would free the most, but it is also the only thing letting the
 * till sell while offline. Dropping it to save one row would take the whole
 * shop down instead of one write. Recorded rather than silently diverged from.
 */
export const EVICTION_ORDER = [
  {
    table: "activity_buffer",
    // Ahead of everything. A diagnostic convenience must never be the reason a
    // completed sale cannot be written to disk.
    why: "buffered activity events",
  },
  {
    table: "transactions_cache",
    why: "the read-only history cache",
  },
  {
    table: "pending_writes",
    // Cosmetic ONLY. A queued price change or cash movement is not expendable.
    onlyTypes: ["favorite_add", "favorite_remove"] as const,
    why: "queued favourite toggles",
  },
] as const;

/**
 * Tables this must never touch, whatever the pressure.
 *
 * `offline_queue` holds completed sales whose money is already in the drawer —
 * it is the data the whole eviction path exists to protect. `products_cache` is
 * the till's ability to sell offline at all. There is no disk-space emergency
 * that is improved by losing either.
 */
export const NEVER_EVICTED = ["offline_queue", "products_cache"] as const;

async function freeExpendableSpace(): Promise<void> {
  for (const step of EVICTION_ORDER) {
    try {
      if ("onlyTypes" in step) {
        const keys = await db.pending_writes
          .where("type")
          .anyOf(step.onlyTypes as unknown as string[])
          .primaryKeys();
        if (keys.length > 0) {
          await db.pending_writes.bulkDelete(keys);
          console.warn(
            `[LocalDB] Storage pressure — dropped ${keys.length} ${step.why}`
          );
        }
        continue;
      }

      const table = db.table(step.table);
      const count = await table.count();
      if (count > 0) {
        await table.clear();
        console.warn(`[LocalDB] Storage pressure — dropped ${count} rows of ${step.why}`);
      }
    } catch (e) {
      // One step failing must not stop the others: the next one down may still
      // free enough for the write that triggered this.
      console.warn(`[LocalDB] Could not clear ${step.table}:`, e);
    }
  }
}

/**
 * Run a write, and on a quota failure make room and try once more.
 *
 * Every IndexedDB write in this app could previously fail on a full disk with
 * nothing but a console line or a generic toast. On the sale path that means a
 * completed sale — money already in the drawer — silently not being recorded.
 *
 * Non-quota errors pass straight through untouched: this is a disk-space
 * rescue, not a general retry.
 */
export async function writeWithQuotaRescue<T>(
  op: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (!isQuotaError(e)) throw e;

    console.warn(`[LocalDB] Quota exceeded during "${label}" — attempting rescue`);
    await freeExpendableSpace();

    try {
      return await op();
    } catch (retryError) {
      if (!isQuotaError(retryError)) throw retryError;
      throw new StorageFullError(
        `Device storage is full — "${label}" could not be saved even after clearing rebuildable caches.`,
        retryError
      );
    }
  }
}

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

  // A product created at the till during an outage exists locally and nowhere
  // else, so the server's ID set cannot possibly contain it — reconcile would
  // read that as "deleted" and wipe the thing the cashier just made, mid-shift.
  // The guard lives HERE rather than at the call sites so every caller gets it.
  //
  // null means the queue could not be read, i.e. we cannot prove which local
  // products are unpushed. Deleting anyway would be exactly the "delete on
  // partial evidence" mistake the reconcile guards exist to prevent, so skip
  // this pass entirely and let the next one do it.
  const pendingIds = await getPendingProductUpsertIds();
  if (pendingIds === null) {
    console.warn(
      "[LocalDB] Reconcile skipped: cannot confirm which local products are unpushed"
    );
    return 0;
  }

  const staleIds = cached
    .filter((p) => !liveSet.has(p.id) && !pendingIds.has(p.id))
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
  // Quota-rescued: this is the single most important write in the app. The
  // money is already in the drawer by the time we get here, so a full disk
  // must not be allowed to lose the record silently. Throws StorageFullError
  // if it truly cannot be made to fit.
  await writeWithQuotaRescue(
    () => db.offline_queue.add(transaction),
    `queue sale ${transaction.transaction_number}`
  );
  console.log(`[LocalDB] Queued transaction ${transaction.transaction_number} for sync`);
}

/**
 * Transactions eligible for a sync attempt right now, oldest first.
 *
 * Excludes two things:
 *   - dead-lettered rows, so a permanently-rejected sale stops consuming a
 *     network request every 30 seconds (see getDeadLetterTransactions())
 *   - rows still inside their retry backoff window (next_attempt_at)
 */
export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  const all = await db.offline_queue.orderBy("created_at").toArray();
  const now = Date.now();
  return all.filter((t) => {
    if (t.failed_permanently) return false;
    if (t.next_attempt_at && Date.parse(t.next_attempt_at) > now) return false;
    return true;
  });
}

/**
 * Transactions waiting to sync, INCLUDING those inside a backoff window.
 *
 * getQueuedTransactions() answers "what should I send right now"; this answers
 * "what has not reached the server yet", which is what the user needs to see
 * and what the pending badge should count. A sale in backoff is still an
 * unsynced sale.
 */
export async function getUnsyncedTransactions(): Promise<QueuedTransaction[]> {
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
 * Delay before attempt N may be made, in milliseconds.
 *
 * 30s → 1m → 5m → 15m → 1h, with ±20% jitter so a shop full of devices
 * reconnecting off the same router does not retry in lockstep.
 *
 * Retries previously had no delay whatsoever: the only spacing was the 30s
 * sync cycle, and that is per-cycle rather than per-row, so a large queue
 * burned its entire retry budget as fast as fetch could fail.
 */
export function computeRetryBackoffMs(attempt: number): number {
  const SCHEDULE_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000];
  const base = SCHEDULE_MS[Math.min(Math.max(attempt, 1) - 1, SCHEDULE_MS.length - 1)];
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(1_000, Math.round(base + jitter));
}

/**
 * Record a PERMANENT failure — the server received the request and rejected
 * this specific row (a 4xx). Returns the new retry count.
 *
 * Only call this when retrying the same payload could plausibly fail the same
 * way. Once `maxRetries` is reached the row is dead-lettered rather than
 * deleted, because it is a completed sale whose money was taken.
 *
 * For a failure that says nothing about the row — the link dropped, the server
 * is down — use recordQueuedTransactionDeferral() instead. Burning a retry on
 * a transport failure is how an entire backlog of good sales gets
 * dead-lettered by a few flaky reconnects.
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
    const dead = count >= maxRetries;
    await db.offline_queue.update(id, {
      retry_count: count,
      last_error: error,
      failed_permanently: dead,
      // A dead row is never retried, so a backoff on it would be meaningless.
      next_attempt_at: dead
        ? undefined
        : new Date(Date.now() + computeRetryBackoffMs(count)).toISOString(),
    });
  });
  return count;
}

/**
 * Record a TRANSIENT failure — the request never got a verdict from the
 * server (fetch threw, or a 5xx/408/429 came back).
 *
 * Deliberately does NOT touch retry_count, so the row can never be
 * dead-lettered by a bad connection. It only notes the error for display and
 * holds the row back briefly so a dead link is not hammered.
 */
export async function recordQueuedTransactionDeferral(
  id: string,
  error: string,
  delayMs: number = 30_000
): Promise<void> {
  await db.offline_queue.update(id, {
    last_error: error,
    next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
  });
}

export async function removeQueuedTransaction(
  id: string
): Promise<void> {
  await db.offline_queue.delete(id);
}

/**
 * Count of sales that have not reached the server (excludes dead-lettered).
 *
 * Counts rows inside a retry backoff window too — this is the number the
 * cashier sees, and a sale waiting out a backoff is still an unsynced sale.
 * Use getDueQueuedCount() for "is there anything to send right now".
 *
 * All three counters below use `.filter().count()` rather than materialising
 * the queue and taking `.length`. `failed_permanently` is a boolean, and
 * IndexedDB cannot index booleans, so a scan is unavoidable — but the old form
 * (`(await getUnsyncedTransactions()).length`) also did an `orderBy` index
 * traversal and allocated a JS array of every queued sale, each carrying its
 * whole `items` payload, purely to read `.length` off it and drop it.
 * getDueQueuedCount() runs on a 30-second interval for as long as the app is
 * open, which is exactly the wrong place to be deserialising a backlog.
 */
export async function getQueuedCount(): Promise<number> {
  return db.offline_queue.filter((t) => !t.failed_permanently).count();
}

/** Count of queued sales eligible for a send attempt right now. */
export async function getDueQueuedCount(): Promise<number> {
  const now = Date.now();
  return db.offline_queue
    .filter(
      (t) =>
        !t.failed_permanently &&
        !(t.next_attempt_at && Date.parse(t.next_attempt_at) > now)
    )
    .count();
}

/** Count of sales that failed permanently and need manual attention. */
export async function getDeadLetterCount(): Promise<number> {
  return db.offline_queue.filter((t) => t.failed_permanently === true).count();
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
  /** Which drawer is being opened. Required since migration 027. */
  register_id: string;
  /** Optional per-shift note, e.g. "Morning rush". */
  label?: string;
  /** "owner", a store_users id, or omitted to leave the drawer unassigned. */
  assigned_user_id?: string;
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

export interface RegisterCreatePayload {
  store_id: string;
  /**
   * Generated on the CLIENT, and the row's real primary key.
   *
   * This is what makes offline register creation safe: a queued
   * `cash_shift_open` refers to this id, so the shift's reference is already
   * valid before the register reaches the server. If the id were assigned
   * server-side the queued shift would point at nothing.
   *
   * It also makes the server call an idempotent upsert rather than an insert
   * that could run twice — the same reasoning as products/write.ts.
   */
  register_id: string;
  name: string;
}

/**
 * Queue a register creation for later sync.
 *
 * Rare — a register is set up once and kept — but a supervisor opening a new
 * drawer during an outage should not be told to come back later, and the shift
 * they open on it has to have something to point at.
 */
export async function queueRegisterCreate(payload: RegisterCreatePayload): Promise<void> {
  const pendingWrite: PendingWrite = {
    id: crypto.randomUUID(),
    type: "register_create",
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  };
  await db.pending_writes.add(pendingWrite);
  console.log(`[LocalDB] Queued register create "${payload.name}"`);
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

// ---- Product writes (offline-capable) ----

/**
 * A product create/update waiting to reach the server.
 *
 * The row is written to `products_cache` FIRST and carries a client-generated
 * id, so the product is sellable the instant the cashier names it — offline
 * included — and the eventual server call is an idempotent upsert on that id
 * rather than an insert that could run twice.
 */
export interface ProductUpsertPayload {
  product: CachedProduct;
  /** Informational: the server upserts either way. */
  mode: "create" | "update";
}

/** Queue a product create/update for the sync engine. */
export async function queueProductUpsert(payload: ProductUpsertPayload): Promise<void> {
  const pendingWrite: PendingWrite = {
    id: crypto.randomUUID(),
    type: "product_upsert",
    payload,
    created_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  };
  await db.pending_writes.add(pendingWrite);
  console.log(`[LocalDB] Queued product upsert for ${payload.product.id}`);
}

/**
 * Catalogue writes the server refused outright.
 *
 * These are the products that exist on this device and nowhere else. Nothing
 * will retry them, so somebody has to be told — see the notice on the POS.
 */
export async function getFailedProductWrites(): Promise<PendingWrite[]> {
  try {
    const writes = await db.pending_writes.where("type").equals("product_upsert").toArray();
    return writes.filter((w) => w.failed_permanently === true);
  } catch (e) {
    console.warn("[LocalDB] Could not read failed product writes:", e);
    return [];
  }
}

/** Forget a failed catalogue write once a human has dealt with it. */
export async function dismissFailedProductWrite(id: string): Promise<void> {
  await db.pending_writes.delete(id);
}

/**
 * Put a permanently-failed write back in the queue.
 *
 * "Permanent" means the server refused this payload, not that it will refuse
 * it forever — a deploy that fixes the validation makes every stranded write
 * viable again. Nothing detects that automatically, so this is the human's
 * way of saying "try it now".
 */
export async function retryFailedProductWrites(): Promise<number> {
  const failed = await getFailedProductWrites();
  for (const w of failed) {
    await db.pending_writes.where("id").equals(w.id).modify((row) => {
      row.failed_permanently = false;
      row.retry_count = 0;
      row.last_error = null;
    });
  }
  return failed.length;
}

/**
 * Product ids that exist locally but have not been confirmed by the server.
 *
 * Returns NULL when the queue could not be read. That is not the same as "no
 * products are pending", and the caller must not treat it as such — deletion
 * requires positive proof, the same rule evaluateReconcile() applies to the
 * server ID set. Skipping a reconcile is always safe; deleting on partial
 * evidence is not.
 */
export async function getPendingProductUpsertIds(): Promise<Set<string> | null> {
  try {
    const ids = new Set<string>();
    // Includes writes marked failed_permanently. Those products exist ONLY on
    // this device, so they are precisely the ones a reconcile must not delete.
    const writes = await db.pending_writes.where("type").equals("product_upsert").toArray();
    for (const write of writes) {
      const payload = write.payload as ProductUpsertPayload | undefined;
      const id = payload && payload.product ? payload.product.id : undefined;
      if (id) ids.add(id);
    }
    return ids;
  } catch (e) {
    console.warn("[LocalDB] Could not read pending product upserts:", e);
    return null;
  }
}

// ---- Activity Buffer Operations ----

/**
 * Hard cap on buffered events.
 *
 * At the observed event rate this is roughly a day of a busy till being
 * offline. Past it the OLDEST events are discarded, not the newest: when the
 * buffer is full, the events near whatever is happening now are the ones worth
 * keeping.
 */
export const ACTIVITY_BUFFER_MAX = 20_000;

/** How many are shed at once when the cap is hit, so trimming is not per-write. */
const ACTIVITY_BUFFER_TRIM = 2_000;

/**
 * Buffer events for later delivery.
 *
 * Deliberately NOT wrapped in writeWithQuotaRescue(): that helper exists to
 * make room for money by sacrificing caches, and doing so on behalf of a log
 * would invert the priority it enforces. If the disk is full, the log is what
 * loses.
 */
export async function bufferActivityEvents(
  events: { occurred_at: string; event: unknown }[]
): Promise<void> {
  if (events.length === 0) return;

  try {
    await db.activity_buffer.bulkAdd(events as BufferedActivityEvent[]);

    const total = await db.activity_buffer.count();
    if (total > ACTIVITY_BUFFER_MAX) {
      const excess = total - ACTIVITY_BUFFER_MAX + ACTIVITY_BUFFER_TRIM;
      const oldest = await db.activity_buffer.orderBy("seq").limit(excess).primaryKeys();
      if (oldest.length > 0) {
        await db.activity_buffer.bulkDelete(oldest);
        console.warn(`[LocalDB] Activity buffer full — discarded ${oldest.length} oldest events`);
      }
    }
  } catch (e) {
    // Never propagate. A failure to record a log must not surface anywhere the
    // operator can see it, let alone fail the action being logged.
    console.warn("[LocalDB] Could not buffer activity events:", e);
  }
}

/** Oldest-first batch of buffered events, for the flusher. */
export async function getBufferedActivityEvents(limit: number): Promise<BufferedActivityEvent[]> {
  try {
    return await db.activity_buffer.orderBy("seq").limit(limit).toArray();
  } catch (e) {
    console.warn("[LocalDB] Could not read activity buffer:", e);
    return [];
  }
}

/** Forget events once the server has them — or once they have been given up on. */
export async function deleteBufferedActivityEvents(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  try {
    await db.activity_buffer.bulkDelete(seqs);
  } catch (e) {
    console.warn("[LocalDB] Could not delete buffered activity events:", e);
  }
}

export async function getActivityBufferCount(): Promise<number> {
  try {
    return await db.activity_buffer.count();
  } catch {
    return 0;
  }
}

export { db as localDB };
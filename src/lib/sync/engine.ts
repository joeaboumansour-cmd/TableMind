// =============================================
// Sync Engine
// Manages online/offline state, pulls products,
// and flushes queued transactions to Supabase
// =============================================

import { createClient } from "@/lib/supabase/client";
import { refreshProductsIntoCache } from "@/lib/products/refresh";
import {
  getQueuedTransactions,
  removeQueuedTransaction,
  getCachedProductsCount,
  getQueuedCount,
  getPendingWrites,
  getPendingWritesByType,
  removePendingWrite,
  recordQueuedTransactionFailure,
} from "@/lib/db/localDB";
import type { QueuedTransaction, PendingWrite } from "@/lib/db/localDB";
import { syncFavoritesFromSupabase, processPendingFavoriteWrites } from "@/lib/frequentlyUsed";
import { connectivity } from "@/lib/connectivity";

type SyncStatus = "idle" | "syncing" | "error" | "offline";
type SyncListener = (status: SyncStatus, pendingCount?: number) => void;

// Maximum retry attempts for pending writes before they are dropped
const MAX_PENDING_WRITE_RETRIES = 5;

// The reconcile-safety rule moved to @/lib/products/refresh alongside the code
// that acts on it. Re-exported here because this is where it has always been
// imported from, and it is still the clearest place to go looking for it.
export { evaluateReconcile } from "@/lib/products/refresh";
export type { ReconcileDecision } from "@/lib/products/refresh";

class SyncEngine {
  private listeners: Set<SyncListener> = new Set();
  private _status: SyncStatus = "idle";
  private syncInProgress = false;
  private storeId: string | null = null;
  private initialized = false;
  private retryIntervalId: ReturnType<typeof setInterval> | null = null;
  private _pendingCount = 0;

  constructor() {
    // Defer browser-only initialization to avoid SSR issues
    if (typeof window !== "undefined") {
      this.initBrowserListeners();
    }
  }

  private async initBrowserListeners(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this._status = connectivity.isOnline ? "idle" : "offline";
    this._pendingCount = await getQueuedCount();
    this.notify();

    // Subscribe to real connectivity changes (heartbeat-based, not navigator.onLine)
    connectivity.subscribe((status) => {
      if (status === "online") {
        console.log("[Sync] Connection restored, triggering sync...");
        this._status = "idle";
        this.notify();
        // Auto-sync when coming back online
        this.syncNow();
        // Start periodic retry
        this.startRetryInterval();
      } else {
        console.log("[Sync] Connection lost, entering offline mode");
        this._status = "offline";
        this.notify();
        // Stop periodic retry when offline
        this.stopRetryInterval();
      }
    });

    // Retry sync when page becomes visible again (e.g., user switches back to tab).
    // NOTE: visibilitychange fires on `document`, NOT `window`. It was previously
    // registered on window, where it only worked incidentally via bubbling in
    // Chrome and did not fire at all on iOS Safari / WKWebView — i.e. the
    // "sync when the cashier returns to the app" path was dead on the primary
    // POS platform.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && connectivity.isOnline) {
        console.log("[Sync] Page became visible, checking for pending sync...");
        this.syncNow();
      }
    });

    // Start periodic retry if online on init
    if (connectivity.isOnline) {
      this.startRetryInterval();
    }
  }

  /**
   * Periodically retry syncing queued transactions
   * Runs every 30 seconds when online
   */
  private startRetryInterval(): void {
    if (this.retryIntervalId) return;
    this.retryIntervalId = setInterval(async () => {
      const count = await getQueuedCount();
      if (count > 0 && connectivity.isOnline) {
        console.log(`[Sync] Periodic check: ${count} queued transactions, attempting sync...`);
        this.syncNow();
      }
    }, 30000); // Every 30 seconds
  }

  private stopRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
  }

  get status(): SyncStatus {
    return this._status;
  }

  get isOnline(): boolean {
    return connectivity.isOnline;
  }

  get isOffline(): boolean {
    return connectivity.isOffline;
  }

  get pendingCount(): number {
    return this._pendingCount;
  }

  /**
   * Set the current store ID for data isolation
   */
  setStoreId(id: string): void {
    this.storeId = id;
  }

  /**
   * Subscribe to sync status changes
   */
  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current status
    listener(this._status, this._pendingCount);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this._status, this._pendingCount));
  }

  /**
   * Refresh the local product cache from Supabase.
   *
   * The algorithm — incremental delta against the updated_at watermark, a
   * completeness check against the server's row count, then a guarded
   * reconcile for deletions — lives in @/lib/products/refresh. It used to live
   * here AND in a second, subtly different copy behind the inventory screen's
   * fetch; the two could run at once and only one of them paginated.
   */
  async pullProducts(): Promise<{
    success: boolean;
    count: number;
    error?: string;
  }> {
    if (!this.storeId) {
      return { success: false, count: 0, error: "No store ID set" };
    }

    try {
      const result = await refreshProductsIntoCache(createClient(), this.storeId);
      console.log(
        `[Sync] ${result.mode} pull: ${result.count} written, ${result.removed} removed`
      );
      return { success: true, count: result.count };
    } catch (error: any) {
      console.error("[Sync] Failed to pull products:", error);
      return { success: false, count: 0, error: error.message };
    }
  }

  /**
   * Push queued offline transactions to Supabase via the API endpoint
   * Using the API route ensures we use the service role client (bypasses RLS)
   * 
   * CRITICAL FIX: Stock decrements are now handled server-side in the
   * /api/transactions POST route. We NO LONGER queue stock decrements here,
   * which prevents double-decrementing for offline transactions.
   */
  async pushQueuedTransactions(): Promise<{
    pushed: number;
    failed: number;
    deadLettered: number;
    errors: string[];
  }> {
    const result = { pushed: 0, failed: 0, deadLettered: 0, errors: [] as string[] };

    // Get all queued transactions ordered by creation time
    const queued = await getQueuedTransactions();

    if (queued.length === 0) {
      return result;
    }

    console.log(`[Sync] Pushing ${queued.length} queued transactions via API...`);

    // Get auth data for API headers
    const authData = localStorage.getItem("goldensquirrel_auth") || "{}";

    // Read legacy stock-decrement writes ONCE, not once per queued transaction.
    // This used to be a full pending_writes table scan inside the loop, so
    // flushing 200 offline sales meant 200 full table reads.
    let legacyStockWrites: PendingWrite[] = [];
    try {
      legacyStockWrites = await getPendingWritesByType("stock_decrement");
    } catch (e) {
      console.warn("[Sync] Failed to read legacy stock decrements:", e);
    }

    for (const txn of queued) {
      try {
        // Build the transaction payload matching the API's expected format
        const payload = {
          transaction_number: txn.transaction_number,
          // Include receipt token so offline transactions get their public receipt
          ...(txn.receipt_token && {
            receipt_token: txn.receipt_token,
          }),
          subtotal: txn.subtotal,
          total_amount: txn.total_amount,
          amount_paid: txn.amount_paid,
          change_given: txn.change_given,
          payment_method: txn.payment_method || "cash",
          usd_subtotal: txn.subtotal_usd,
          usd_total_amount: txn.total_usd,
          usd_amount_paid: txn.amount_paid_usd || 0,
          usd_change_given: txn.change_given_usd || 0,
          // Include user info - ALWAYS send user_name, independently of user_id
          ...(txn.user_name && {
            user_name: txn.user_name,
          }),
          ...(txn.user_id && {
            user_id: txn.user_id,
          }),
          items: txn.items.map((item) => ({
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            currency: item.currency,
            unit_price_usd: item.unit_price_usd || 0,
            total_price_usd: item.total_price_usd || 0,
          })),
        };

        const response = await fetch("/api/transactions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-auth-data": authData,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`API error ${response.status}: ${errorBody}`);
        }

        const apiResult = await response.json();

        // NOTE: Stock decrements are handled server-side in the /api/transactions
        // POST route. We do NOT queue stock decrements here anymore.
        // This prevents double-decrementing for offline transactions.

        // CRITICAL FIX: Clean up any legacy stock_decrement pending writes
        // for this transaction's items. These were queued by older versions
        // of the app and would cause double-decrementing now that the API
        // handles stock server-side.
        try {
          const txnProductIds = new Set(txn.items.map((i) => i.product_id));
          const matching = legacyStockWrites.filter((w) =>
            txnProductIds.has((w.payload as any)?.product_id)
          );
          for (const legacyWrite of matching) {
            await removePendingWrite(legacyWrite.id);
            console.log(`[Sync] Cleaned up legacy stock decrement ${legacyWrite.id} for transaction ${txn.transaction_number}`);
          }
          // Drop them from the in-memory list so a later transaction in this
          // same flush doesn't try to remove an already-removed write.
          if (matching.length > 0) {
            const removedIds = new Set(matching.map((w) => w.id));
            legacyStockWrites = legacyStockWrites.filter((w) => !removedIds.has(w.id));
          }
        } catch (e) {
          console.warn("[Sync] Failed to clean up legacy stock decrements:", e);
        }

        // Remove from queue after successful sync
        await removeQueuedTransaction(txn.id);
        result.pushed++;
        console.log(`[Sync] Synced transaction ${txn.transaction_number}`);
      } catch (error: any) {
        console.error(
          `[Sync] Failed to sync transaction ${txn.transaction_number}:`,
          error
        );
        result.failed++;
        result.errors.push(
          `Transaction ${txn.transaction_number}: ${error.message}`
        );

        // Record the attempt. Queued transactions previously had NO retry cap,
        // so a permanently-rejected sale (e.g. a deleted product_id, or the
        // DECIMAL(10,2) overflow in audit P1-3) retried forever, every 30s.
        // The row is dead-lettered rather than deleted — it is a completed
        // sale whose money was taken, so it must never be silently dropped.
        try {
          const attempts = await recordQueuedTransactionFailure(
            txn.id,
            error?.message ?? String(error),
            MAX_PENDING_WRITE_RETRIES
          );
          if (attempts >= MAX_PENDING_WRITE_RETRIES) {
            console.error(
              `[Sync] Transaction ${txn.transaction_number} exhausted ${MAX_PENDING_WRITE_RETRIES} retries — moved to dead-letter for manual resolution`
            );
            result.deadLettered++;
          }
        } catch (e) {
          console.warn("[Sync] Failed to record transaction retry:", e);
        }
      }
    }

    // Update pending count after sync attempt
    this._pendingCount = await getQueuedCount();
    this.notify();

    return result;
  }

  private async processCashShiftWrite(write: PendingWrite): Promise<void> {
    const authData = localStorage.getItem("goldensquirrel_auth") || "{}";
    // Build auth header including user_id for employees so the API
    // correctly verifies the caller (owner vs employee with permission).
    let headerPayload: any = {};
    try {
      headerPayload = JSON.parse(authData);
    } catch {}
    const storedUser = localStorage.getItem("goldensquirrel_user");
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        if (!u.isOwner && u.id) headerPayload.user_id = u.id;
      } catch {}
    }
    const h = { "Content-Type": "application/json", "x-auth-data": JSON.stringify(headerPayload) };
    const p = write.payload as any;
    const body = JSON.stringify({
      ...(write.type === "cash_shift_open" ? { action: "open", business_date: p.business_date, opening_ll: p.opening_ll, opening_usd: p.opening_usd, user_id: p.user_id, user_name: p.user_name } : {}),
      ...(write.type === "cash_shift_close" ? { action: "close", shift_id: p.shift_id, closing_ll: p.closing_ll, closing_usd: p.closing_usd, notes: p.notes, user_id: p.user_id, user_name: p.user_name } : {}),
      ...(write.type === "cash_adjustment" ? { shift_id: p.shift_id, adjustment_type: p.adjustment_type, amount_ll: p.amount_ll, amount_usd: p.amount_usd, reason: p.reason, user_id: p.user_id, user_name: p.user_name } : {}),
    });
    const url = write.type === "cash_shift_open" || write.type === "cash_shift_close" ? "/api/cash-shifts" : "/api/cash-adjustments";
    const r = await fetch(url, { method: "POST", headers: h, body });
    if (!r.ok) throw new Error(`${write.type} failed (${r.status})`);
  }

  /**
   * Process pending stock decrements from the pending_writes table.
   * Each stock decrement is processed via the Supabase RPC.
   * If a decrement fails, it is retried on the next sync cycle.
   * 
   * CRITICAL FIX: Added retry limit — writes that fail more than
   * MAX_PENDING_WRITE_RETRIES times are dropped to prevent infinite retry loops.
   */
  async processPendingWrites(): Promise<{
    processed: number;
    failed: number;
    errors: string[];
  }> {
    const result = { processed: 0, failed: 0, errors: [] as string[] };

    const pendingWrites = await getPendingWrites();
    const stockDecrements = pendingWrites.filter(
      (w) => w.type === "stock_decrement"
    );
    const cashWrites = pendingWrites.filter(
      (w) => w.type === "cash_shift_open" || w.type === "cash_shift_close" || w.type === "cash_adjustment"
    );

    if (stockDecrements.length === 0 && cashWrites.length === 0) {
      return result;
    }

    console.log(`[Sync] Processing ${stockDecrements.length} stock decrements + ${cashWrites.length} cash ops...`);

    const supabase = createClient();

    // Process cash operations first (order matters)
    for (const write of cashWrites) {
      // Cash writes incremented retry_count but never checked it, so a
      // permanently-failing shift open/close retried every 30s forever.
      // Apply the same cap the stock-decrement loop below already uses.
      if ((write.retry_count ?? 0) >= MAX_PENDING_WRITE_RETRIES) {
        console.error(
          `[Sync] Dropping ${write.type} ${write.id} after ${write.retry_count} retries: ${write.last_error}`
        );
        await removePendingWrite(write.id);
        result.failed++;
        result.errors.push(
          `${write.type} ${write.id}: dropped after ${write.retry_count} retries (${write.last_error})`
        );
        continue;
      }

      try {
        await this.processCashShiftWrite(write);
        await removePendingWrite(write.id);
        result.processed++;
      } catch (error: any) {
        console.error(`[Sync] Failed ${write.type}:`, error);
        result.failed++;
        result.errors.push(`${write.type}: ${error.message}`);
        try {
          const { localDB } = await import("@/lib/db/localDB");
          await localDB.pending_writes.where("id").equals(write.id).modify((w: any) => {
            w.retry_count = (w.retry_count ?? 0) + 1;
            w.last_error = error.message;
          });
        } catch {}
      }
    }

    for (const write of stockDecrements) {
      // CRITICAL FIX: Drop writes that have exceeded the retry limit
      if (write.retry_count >= MAX_PENDING_WRITE_RETRIES) {
        console.error(`[Sync] Dropping pending write ${write.id} after ${write.retry_count} retries: ${write.last_error}`);
        await removePendingWrite(write.id);
        result.failed++;
        result.errors.push(`Stock decrement ${write.id}: dropped after ${write.retry_count} retries (${write.last_error})`);
        continue;
      }

      try {
        const payload = write.payload as {
          product_id: string;
          quantity: number;
          store_id: string;
        };

        const { error: stockError } = await supabase.rpc("decrement_stock", {
          product_id: payload.product_id,
          quantity: payload.quantity,
          p_store_id: payload.store_id || null,
        });

        if (stockError) {
          throw new Error(stockError.message || "Stock decrement failed");
        }

        // Success — remove from pending writes
        await removePendingWrite(write.id);
        result.processed++;
        console.log(`[Sync] Processed stock decrement for product ${payload.product_id}`);
      } catch (error: any) {
        console.error(
          `[Sync] Failed to process stock decrement ${write.id}:`,
          error
        );
        result.failed++;
        result.errors.push(
          `Stock decrement ${write.id}: ${error.message}`
        );

        // Update retry count and last error
        // Use direct DB modification since updatePendingWriteRetry may not be available
        try {
          const { localDB } = await import("@/lib/db/localDB");
          await localDB.pending_writes
            .where("id")
            .equals(write.id)
            .modify((w) => {
              w.retry_count += 1;
              w.last_error = error.message;
            });
        } catch (e) {
          console.warn("[Sync] Failed to update pending write retry count:", e);
        }
      }
    }

    return result;
  }

  /**
   * Full sync: pull latest products, push queued transactions, and process pending writes
   */
  async syncNow(): Promise<{
    success: boolean;
    pulled: number;
    pushed: number;
    failed: number;
    errors: string[];
  }> {
    if (this.syncInProgress || !connectivity.isOnline) {
      return {
        success: connectivity.isOnline,
        pulled: 0,
        pushed: 0,
        failed: 0,
        errors: [],
      };
    }

    this.syncInProgress = true;
    this._status = "syncing";
    this.notify();

    try {
      // Pull latest products (refreshed stock, prices, etc.)
      const pullResult = await this.pullProducts();

      // Sync favorites from Supabase (pull remote favorites into localStorage)
      if (this.storeId) {
        await syncFavoritesFromSupabase(this.storeId);
      }

      // Push queued transactions (stock decrements handled server-side)
      const pushResult = await this.pushQueuedTransactions();

      // Process pending stock decrements (only for legacy/offline queued writes)
      const pendingResult = await this.processPendingWrites();

      // Process pending favorite writes (add/remove starred items)
      const favoriteResult = await processPendingFavoriteWrites();

      const success = pullResult.success;
      this._status = success ? "idle" : "error";
      this.notify();

      console.log(
        `[Sync] Complete: pulled ${pullResult.count} products, ` +
        `pushed ${pushResult.pushed} transactions, ` +
        `processed ${pendingResult.processed} stock decrements, ` +
        `processed ${favoriteResult.processed} favorite writes`
      );

      return {
        success,
        pulled: pullResult.count,
        pushed: pushResult.pushed,
        failed: pushResult.failed + pendingResult.failed + favoriteResult.failed,
        errors: [...pushResult.errors, ...pendingResult.errors, ...favoriteResult.errors],
      };
    } catch (error: any) {
      this._status = "error";
      this.notify();
      return {
        success: false,
        pulled: 0,
        pushed: 0,
        failed: 0,
        errors: [error.message],
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Initialize the local cache (called on app startup)
   * Pulls products from Supabase and pushes queued transactions
   * Uses syncNow() to ensure the syncInProgress guard prevents race conditions
   */
  async initialize(storeId: string): Promise<void> {
    this.storeId = storeId;

    if (connectivity.isOnline) {
      // Use syncNow() instead of calling pushQueuedTransactions() directly
      // This ensures the syncInProgress flag prevents concurrent syncs
      // (e.g., the online event listener also triggering syncNow())
      const queuedCount = await getQueuedCount();
      if (queuedCount > 0) {
        console.log(`[Sync] Found ${queuedCount} queued transactions from previous session, attempting sync...`);
      }

      // syncNow() handles pulling products, pushing queued transactions, and processing pending writes
      await this.syncNow();

      // If syncNow() was blocked by syncInProgress (another sync already running),
      // ensure we still pull products at least once
      const count = await getCachedProductsCount(storeId);
      if (count === 0) {
        console.log("[Sync] Local cache still empty after syncNow, pulling directly...");
        await this.pullProducts();
      }
    } else {
      console.log(
        "[Sync] Offline at startup, using existing cache if available"
      );
    }
  }

  /**
   * Clean up resources (call on unmount)
   */
  destroy(): void {
    this.stopRetryInterval();
    this.listeners.clear();
  }
}

// Singleton instance
export const syncEngine = new SyncEngine();
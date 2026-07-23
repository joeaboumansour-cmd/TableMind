// =============================================
// Sync Engine
// Manages online/offline state, pulls products,
// and flushes queued transactions to Supabase
// =============================================

import { createClient } from "@/lib/supabase/client";
import {
  cacheProducts,
  getQueuedTransactions,
  removeQueuedTransaction,
  getCachedProductsCount,
  getCachedProducts,
  getQueuedCount,
} from "@/lib/db/localDB";
import type { CachedProduct, QueuedTransaction } from "@/lib/db/localDB";

type SyncStatus = "idle" | "syncing" | "error" | "offline";
type SyncListener = (status: SyncStatus, pendingCount?: number) => void;

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

    this._status = navigator.onLine ? "idle" : "offline";
    this._pendingCount = await getQueuedCount();
    this.notify();

    // Listen for online/offline events
    window.addEventListener("online", () => {
      console.log("[Sync] Connection restored, triggering sync...");
      this._status = "idle";
      this.notify();
      // Auto-sync when coming back online
      this.syncNow();
      // Start periodic retry
      this.startRetryInterval();
    });

    window.addEventListener("offline", () => {
      console.log("[Sync] Connection lost, entering offline mode");
      this._status = "offline";
      this.notify();
      // Stop periodic retry when offline
      this.stopRetryInterval();
    });

    // Retry sync when page becomes visible again (e.g., user switches back to tab)
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        console.log("[Sync] Page became visible, checking for pending sync...");
        this.syncNow();
      }
    });

    // Start periodic retry if online on init
    if (navigator.onLine) {
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
      if (count > 0 && navigator.onLine) {
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
    return navigator.onLine;
  }

  get isOffline(): boolean {
    return !navigator.onLine;
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
   * Pull latest products from Supabase into IndexedDB cache
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
      const supabase = createClient();
      const { data: products, error } = await supabase
        .from("products")
        .select("*")
        .eq("store_id", this.storeId)
        .order("name");

      if (error) throw error;

      if (products && products.length > 0) {
        // Map to cached product format
        const cached: CachedProduct[] = products.map((p: any) => ({
          id: p.id,
          store_id: p.store_id,
          name: p.name,
          barcode: p.barcode,
          cost_price: p.cost_price,
          selling_price: p.selling_price,
          currency: p.currency || "LL",
          profit_percentage: p.profit_percentage,
          stock_quantity: p.stock_quantity,
          min_stock_threshold: p.min_stock_threshold,
          parent_id: p.parent_id || null,
          variant_name: p.variant_name || null,
          updated_at: p.updated_at || new Date().toISOString(),
        }));

        await cacheProducts(cached);
        console.log(`[Sync] Pulled ${cached.length} products to local cache`);
        return { success: true, count: cached.length };
      }

      return { success: true, count: 0 };
    } catch (error: any) {
      console.error("[Sync] Failed to pull products:", error);
      return { success: false, count: 0, error: error.message };
    }
  }

  /**
   * Push queued offline transactions to Supabase via the API endpoint
   * Using the API route ensures we use the service role client (bypasses RLS)
   */
  async pushQueuedTransactions(): Promise<{
    pushed: number;
    failed: number;
    errors: string[];
  }> {
    const result = { pushed: 0, failed: 0, errors: [] as string[] };

    // Get all queued transactions ordered by creation time
    const queued = await getQueuedTransactions();

    if (queued.length === 0) {
      return result;
    }

    console.log(`[Sync] Pushing ${queued.length} queued transactions via API...`);

    // Get auth data for API headers
    const authData = localStorage.getItem("goldensquirrel_auth") || "{}";

    for (const txn of queued) {
      try {
        // Build the transaction payload matching the API's expected format
        const payload = {
          transaction_number: txn.transaction_number,
          subtotal: txn.subtotal,
          total_amount: txn.total_amount,
          amount_paid: txn.amount_paid,
          change_given: txn.change_given,
          payment_method: txn.payment_method || "cash",
          usd_subtotal: txn.subtotal_usd,
          usd_total_amount: txn.total_usd,
          usd_amount_paid: txn.amount_paid_usd || 0,
          usd_change_given: txn.change_given_usd || 0,
          // Include WhatsApp phone if provided
          ...(txn.whatsapp_sent_to && {
            whatsapp_sent_to: txn.whatsapp_sent_to,
          }),
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

        // Step 2: Decrement stock for each item via RPC (this needs anonymous client since it's a function call, but the API could handle this too)
        // The API route already creates the transaction, so we just need to decrement stock
        const supabase = createClient();
        for (const item of txn.items) {
          const { error: stockError } = await supabase.rpc("decrement_stock", {
            product_id: item.product_id,
            quantity: item.quantity,
          });
          if (stockError) {
            console.warn(
              `[Sync] Stock decrement warning for ${item.product_name}:`,
              stockError
            );
          }
        }

        // Step 3: Remove from queue after successful sync
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
      }
    }

    // Update pending count after sync attempt
    this._pendingCount = await getQueuedCount();
    this.notify();

    return result;
  }

  /**
   * Full sync: pull latest products and push queued transactions
   */
  async syncNow(): Promise<{
    success: boolean;
    pulled: number;
    pushed: number;
    failed: number;
    errors: string[];
  }> {
    if (this.syncInProgress || !navigator.onLine) {
      return {
        success: navigator.onLine,
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

      // Push queued transactions
      const pushResult = await this.pushQueuedTransactions();

      const success = pullResult.success;
      this._status = success ? "idle" : "error";
      this.notify();

      console.log(`[Sync] Complete: pulled ${pullResult.count} products, pushed ${pushResult.pushed} transactions`);

      return {
        success,
        pulled: pullResult.count,
        pushed: pushResult.pushed,
        failed: pushResult.failed,
        errors: pushResult.errors,
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

    if (navigator.onLine) {
      // Use syncNow() instead of calling pushQueuedTransactions() directly
      // This ensures the syncInProgress flag prevents concurrent syncs
      // (e.g., the online event listener also triggering syncNow())
      const queuedCount = await getQueuedCount();
      if (queuedCount > 0) {
        console.log(`[Sync] Found ${queuedCount} queued transactions from previous session, attempting sync...`);
      }

      // syncNow() handles both pulling products and pushing queued transactions
      await this.syncNow();

      // If syncNow() was blocked by syncInProgress (another sync already running),
      // ensure we still pull products at least once
      const count = await getCachedProductsCount();
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
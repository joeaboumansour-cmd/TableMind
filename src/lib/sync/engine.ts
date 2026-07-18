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
} from "@/lib/db/localDB";
import type { CachedProduct } from "@/lib/db/localDB";

type SyncStatus = "idle" | "syncing" | "error" | "offline";
type SyncListener = (status: SyncStatus, pendingCount?: number) => void;

class SyncEngine {
  private listeners: Set<SyncListener> = new Set();
  private _status: SyncStatus = "idle";
  private syncInProgress = false;
  private storeId: string | null = null;
  private initialized = false;

  constructor() {
    // Defer browser-only initialization to avoid SSR issues
    if (typeof window !== "undefined") {
      this.initBrowserListeners();
    }
  }

  private initBrowserListeners(): void {
    if (this.initialized) return;
    this.initialized = true;

    this._status = navigator.onLine ? "idle" : "offline";

    // Listen for online/offline events
    window.addEventListener("online", () => {
      console.log("[Sync] Connection restored, triggering sync...");
      this._status = "idle";
      this.notify();
      // Auto-sync when coming back online
      this.syncNow();
    });

    window.addEventListener("offline", () => {
      console.log("[Sync] Connection lost, entering offline mode");
      this._status = "offline";
      this.notify();
    });
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
    listener(this._status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const pendingCount = 0; // Will be updated by syncNow
    this.listeners.forEach((l) => l(this._status, pendingCount));
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
   * Push queued offline transactions to Supabase
   */
  async pushQueuedTransactions(): Promise<{
    pushed: number;
    failed: number;
    errors: string[];
  }> {
    const result = { pushed: 0, failed: 0, errors: [] as string[] };
    const supabase = createClient();

    // Get all queued transactions ordered by creation time
    const queued = await getQueuedTransactions();

    if (queued.length === 0) {
      return result;
    }

    console.log(`[Sync] Pushing ${queued.length} queued transactions...`);

    for (const txn of queued) {
      try {
        // Step 1: Insert the transaction
        const { data: transaction, error: txnError } = await supabase
          .from("transactions")
           .insert({
             store_id: txn.store_id,
             transaction_number: txn.transaction_number,
             subtotal: txn.subtotal,
             total_amount: txn.total_amount,
             amount_paid: txn.amount_paid,
             change_given: txn.change_given,
             payment_method: txn.payment_method,
             usd_subtotal: txn.subtotal_usd,
             usd_total_amount: txn.total_usd,
             usd_amount_paid: txn.amount_paid_usd || txn.amount_paid,
             usd_change_given: txn.change_given_usd || txn.change_given,
             // Include WhatsApp phone if provided
             ...(txn.whatsapp_sent_to && {
               whatsapp_sent_to: txn.whatsapp_sent_to,
               whatsapp_sent_at: new Date().toISOString(),
             }),
             // Include user info if provided
             ...(txn.user_id && {
               user_id: txn.user_id,
               user_name: txn.user_name,
             }),
           })
          .select()
          .single();

        if (txnError) throw txnError;

        // Step 2: Insert transaction items
        const txnItems = txn.items.map((item) => ({
          store_id: txn.store_id,
          transaction_id: transaction.id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          currency: item.currency,
        }));

        const { error: itemsError } = await supabase
          .from("transaction_items")
          .insert(txnItems);

        if (itemsError) throw itemsError;

        // Step 3: Decrement stock for each item
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

        // Step 4: Remove from queue after successful sync
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
   * Pulls products from Supabase if cache is empty
   */
  async initialize(storeId: string): Promise<void> {
    this.storeId = storeId;

    if (navigator.onLine) {
      // Check if cache is empty
      const count = await getCachedProductsCount();
      if (count === 0) {
        console.log("[Sync] Local cache empty, pulling from Supabase...");
        await this.pullProducts();
      } else {
        console.log(
          `[Sync] Local cache has ${count} products, refreshing...`
        );
        // Always refresh on init to ensure fresh data
        await this.pullProducts();
      }
    } else {
      console.log(
        "[Sync] Offline at startup, using existing cache if available"
      );
    }
  }
}

// Singleton instance
export const syncEngine = new SyncEngine();
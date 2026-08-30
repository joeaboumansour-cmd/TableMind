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
  getDueQueuedCount,
  getPendingWrites,
  getPendingWritesByType,
  removePendingWrite,
  recordQueuedTransactionFailure,
  recordQueuedTransactionDeferral,
} from "@/lib/db/localDB";
import type { QueuedTransaction, PendingWrite } from "@/lib/db/localDB";
import { syncFavoritesFromSupabase, processPendingFavoriteWrites } from "@/lib/frequentlyUsed";
import { connectivity } from "@/lib/connectivity";
import { buildAuthHeaders } from "@/lib/auth/requestHeaders";
import { logActivity } from "@/lib/activity/logger";
import { setSyncBusy } from "@/lib/activity/flush";

type SyncStatus = "idle" | "syncing" | "error" | "offline";
type SyncListener = (status: SyncStatus, pendingCount?: number) => void;

// Maximum retry attempts for pending writes before they are dropped
const MAX_PENDING_WRITE_RETRIES = 5;

/**
 * Minimum gap between syncs triggered by the app being foregrounded.
 *
 * Shorter than the 30s retry interval, so this never delays anything a
 * returning cashier is waiting for — it only collapses the burst that comes
 * from flicking between apps.
 */
const VISIBILITY_SYNC_MIN_INTERVAL_MS = 20000;

/**
 * Name of the cross-tab sync lock.
 *
 * `syncInProgress` below is a per-INSTANCE guard, and every tab has its own
 * SyncEngine instance — but they all share one IndexedDB. So two tabs would
 * each read `offline_queue` and each POST the same sales. The unique
 * (store_id, transaction_number) constraint meant this was correct by luck
 * rather than by design: the loser hits the duplicate branch, which returns
 * early and SKIPS the stock decrement.
 *
 * A Web Lock makes only one tab flush at a time, device-wide. Held for the
 * whole sync so a second tab waits rather than racing.
 */
const SYNC_LOCK = "goldensquirrel_sync";

/**
 * Run `fn` holding the cross-tab sync lock, or skip if another tab holds it.
 *
 * `ifAvailable` rather than queueing: if a sibling tab is already flushing,
 * this tab has nothing useful to add — the queue is shared, so that flush is
 * doing this tab's work too. Waiting would just pile up redundant syncs.
 *
 * Falls back to running unlocked where the Web Locks API is unavailable
 * (older WebViews), which is exactly the behaviour that existed before.
 */
async function withSyncLock<T>(fn: () => Promise<T>, skipped: T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return fn();
  }
  return navigator.locks.request(
    SYNC_LOCK,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        console.log("[Sync] Another tab is already syncing — skipping this run");
        return skipped;
      }
      return fn();
    }
  ) as Promise<T>;
}

/**
 * A failure that says nothing about the row we tried to send.
 *
 * This distinction is the difference between "the shop's DSL blinked" and
 * "this sale will never be accepted", and it used to not exist: every failure
 * incremented retry_count. Because the queue is flushed serially and
 * connectivity is only checked once at the top of syncNow(), a link that died
 * at sale 12 of 500 made the remaining 488 fail instantly — each burning a
 * retry — in a fraction of a second. Three such reconnects dead-lettered
 * every queued sale in the shop.
 *
 * Transient:
 *   - fetch() threw at all (network down, DNS, TLS, aborted). The request
 *     never reached the server, so the row is unjudged.
 *   - 5xx: the server is broken, not the payload.
 *   - 408 / 429: explicitly "try again later".
 *   - 401 / 403: see below.
 *
 * Everything else (4xx) is the server having looked at this specific payload
 * and rejected it, which is worth counting against the retry budget.
 *
 * 401/403 are deliberately transient even though they are 4xx. They say
 * nothing about the sale — they say the CALLER is not currently authenticated,
 * which is a client-state problem that a re-login fixes. This is not
 * hypothetical: an offline login used to leave `goldensquirrel_auth` unset, so
 * the engine sent `x-auth-data: {}` and every queued sale came back
 * `401 Unauthorized - No store_id in auth data`. Counting that against the
 * budget would dead-letter a whole day of real takings because of a login
 * bug. Root cause is fixed in AuthContext.saveLegacyAuthToStorage; this is the
 * belt-and-braces so no future auth regression can destroy money.
 */
function isTransientSyncFailure(response: Response | null): boolean {
  if (!response) return true; // fetch threw — no verdict was ever returned
  if (response.status >= 500) return true;
  if (response.status === 408 || response.status === 429) return true;
  if (response.status === 401 || response.status === 403) return true;
  return false;
}

/**
 * Carries the HTTP response (if there was one) alongside the error, so the
 * catch block can classify without re-parsing an error message.
 */
class SyncHttpError extends Error {
  constructor(message: string, public readonly response: Response) {
    super(message);
    this.name = "SyncHttpError";
  }
  /** Convenience for the retry classification. */
  get status(): number {
    return this.response.status;
  }
}

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
  /** Last sync triggered by the app being foregrounded. See the listener. */
  private lastVisibilitySyncAt = 0;

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
    // Throttled. A full sync is a catalogue delta pull plus a queue flush plus
    // a pending-writes pass, and this fires on EVERY foreground — a cashier
    // flicking between the till and WhatsApp ran the lot each time. Worse, it
    // double-fired: connectivity also re-probes on visibilitychange, and a
    // probe that resolves to "online" runs syncNow() through the subscriber
    // above. syncInProgress and the cross-tab lock made that harmless but not
    // free.
    //
    // 20s is comfortably shorter than the 30s retry interval, so nothing a
    // returning cashier needs is delayed — it only collapses a burst.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !connectivity.isOnline) return;

      const now = Date.now();
      if (now - this.lastVisibilitySyncAt < VISIBILITY_SYNC_MIN_INTERVAL_MS) return;
      this.lastVisibilitySyncAt = now;

      console.log("[Sync] Page became visible, checking for pending sync...");
      this.syncNow();
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
      // "Due", not "unsynced": a row inside its retry backoff window is still
      // unsynced but must not trigger a send. Using the unsynced count here
      // would defeat the backoff entirely.
      const count = await getDueQueuedCount();
      if (count > 0 && connectivity.isOnline) {
        console.log(`[Sync] Periodic check: ${count} queued transactions due, attempting sync...`);
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
    /**
     * True when the flush stopped early because the connection died rather
     * than because anything was wrong with the data. Lets the caller show
     * "still pending" instead of a scary error for the app's normal condition.
     */
    abortedOnTransient: boolean;
    errors: string[];
  }> {
    const result = {
      pushed: 0,
      failed: 0,
      deadLettered: 0,
      abortedOnTransient: false,
      errors: [] as string[],
    };

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
          // The moment of SALE, not the moment of sync.
          //
          // This was previously omitted, so Postgres applied its DEFAULT NOW()
          // and every sale made during an outage was recorded as happening on
          // the day the shop reconnected. That silently corrupts cash-shift
          // reconciliation (which matches on created_at::date) and the hourly
          // and weekday analytics. The API clamps this to <= now(), so a
          // device with a fast clock cannot write future-dated sales.
          created_at: txn.created_at,
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
            // `?? null`, never `|| null`: [] means "a menu line with nothing
            // changed", which is what the kitchen board filters tickets on.
            modifiers: item.modifiers ?? null,
            note: item.note ?? null,
            combo_children: item.combo_children ?? null,
          })),
          // ⚠️ Forwarding this is what makes an OFFLINE menu sale deduct the
          // right thing.
          //
          // Without it the server falls back to deriving decrements from
          // `items` — which names the sandwich, not the bread and pickles — so
          // a sale rung up during an outage would decrement the menu item
          // instead of its ingredients. Silent, offline-only, and invisible
          // until a stock take.
          //
          // Spread conditionally so a row queued BEFORE this field existed
          // sends no key at all and gets exactly today's fallback behaviour,
          // rather than an explicit undefined or an empty array (which would
          // wrongly mean "this sale consumes nothing").
          ...(Array.isArray(txn.stock_decrements) && {
            stock_decrements: txn.stock_decrements,
          }),
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
          // SyncHttpError so the catch below can classify on the status code
          // rather than trying to parse it back out of a message.
          throw new SyncHttpError(`API error ${response.status}: ${errorBody}`, response);
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
        const message = error?.message ?? String(error);
        const response = error instanceof SyncHttpError ? error.response : null;
        const transient = isTransientSyncFailure(response);

        console.error(
          `[Sync] Failed to sync transaction ${txn.transaction_number} (${transient ? "transient" : "permanent"}):`,
          error
        );
        result.failed++;
        result.errors.push(`Transaction ${txn.transaction_number}: ${message}`);

        if (transient) {
          // The request never got a verdict, so this row has NOT been judged.
          // Do not spend a retry on it, and stop the flush: the link is down,
          // and grinding through the rest of the queue would fail every one of
          // them instantly and — before this branch existed — dead-letter the
          // lot. The queue is ordered by created_at, so the next flush simply
          // resumes here.
          try {
            await recordQueuedTransactionDeferral(txn.id, message);
          } catch (e) {
            console.warn("[Sync] Failed to record transaction deferral:", e);
          }

          result.abortedOnTransient = true;
          const remaining = queued.length - (result.pushed + result.failed);
          console.warn(
            `[Sync] Transport failure — stopping flush with ${remaining} transaction(s) untouched. ` +
              `No retries were consumed; they will be resent on the next reconnect.`
          );
          break;
        }

        // Permanent: the server looked at this specific payload and rejected
        // it (e.g. a deleted product_id, or the DECIMAL(10,2) overflow in
        // audit P1-3). Worth counting against the retry budget. The row is
        // dead-lettered rather than deleted — it is a completed sale whose
        // money was taken, so it must never be silently dropped.
        try {
          const attempts = await recordQueuedTransactionFailure(
            txn.id,
            message,
            MAX_PENDING_WRITE_RETRIES
          );
          if (attempts >= MAX_PENDING_WRITE_RETRIES) {
            console.error(
              `[Sync] Transaction ${txn.transaction_number} exhausted ${MAX_PENDING_WRITE_RETRIES} retries — moved to dead-letter for manual resolution`
            );
            result.deadLettered++;
            logActivity("sync.dead_letter", {
              target: txn.transaction_number,
              details: { attempts, error: message, total_amount: txn.total_amount },
            });
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
        // ALWAYS send user_id now. The owner's session id is the store id, so
        // sending it lets the server identify them positively instead of
        // inferring ownership from an absent field — which is what let any
        // employee claim owner rights over the cash drawer (audit P0-3).
        headerPayload.user_id = u.isOwner ? headerPayload.store_id : u.id;
      } catch {}
    }
    const h = { "Content-Type": "application/json", "x-auth-data": JSON.stringify(headerPayload) };
    const p = write.payload as any;
    const body = JSON.stringify({
      ...(write.type === "cash_shift_open" ? { action: "open", register_id: p.register_id, assigned_user_id: p.assigned_user_id, label: p.label, business_date: p.business_date, opening_ll: p.opening_ll, opening_usd: p.opening_usd, user_id: p.user_id, user_name: p.user_name } : {}),
      ...(write.type === "cash_shift_close" ? { action: "close", shift_id: p.shift_id, closing_ll: p.closing_ll, closing_usd: p.closing_usd, notes: p.notes, user_id: p.user_id, user_name: p.user_name } : {}),
      ...(write.type === "cash_adjustment" ? { shift_id: p.shift_id, adjustment_type: p.adjustment_type, amount_ll: p.amount_ll, amount_usd: p.amount_usd, reason: p.reason, user_id: p.user_id, user_name: p.user_name } : {}),
      // The id was generated on the client and is the row's real primary key,
      // so the queued shift that points at it stays valid. Sending it also
      // makes this push idempotent.
      ...(write.type === "register_create" ? { id: p.register_id, name: p.name } : {}),
    });
    const url =
      write.type === "register_create"
        ? "/api/cash-registers"
        : write.type === "cash_shift_open" || write.type === "cash_shift_close"
          ? "/api/cash-shifts"
          : "/api/cash-adjustments";
    const r = await fetch(url, { method: "POST", headers: h, body });
    if (!r.ok) throw new Error(`${write.type} failed (${r.status})`);
  }

  /**
   * Push a product create/update raised at the till.
   *
   * The row carries a client-generated id and the route is an UPSERT on it, so
   * a write that arrives twice (a lost response, two tabs flushing the same
   * IndexedDB) converges rather than duplicating the product.
   */
  private async processProductUpsertWrite(write: PendingWrite): Promise<void> {
    const payload = write.payload as { product?: any } | undefined;
    const product = payload?.product;
    if (!product?.id) {
      // Nothing recoverable here — a payload with no product cannot be retried
      // into existence. Throwing lets the caller count it against the cap.
      throw new Error("product_upsert payload has no product");
    }

    const response = await fetch("/api/products", {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify(product),
    });
    if (!response.ok) {
      // Carry the server's own message. "product_upsert failed (400)" with no
      // reason is undiagnosable from a shop floor, and this is the one class of
      // failure where the reason is the whole story.
      let reason = "";
      try {
        const body = await response.json();
        reason = body?.error ? `: ${body.error}` : "";
      } catch {
        /* not JSON; the status is all we have */
      }
      throw new SyncHttpError(
        `product_upsert failed (${response.status})${reason}`,
        response
      );
    }
  }

  /**
   * Retire a catalogue write that cannot succeed.
   *
   * It is marked, NOT deleted. Deleting it lost two things at once: the record
   * that anything went wrong, and the reconcile guard that keeps the product
   * the cashier created from being wiped out of the local cache on the next
   * sync — so the product would quietly disappear from the till as well as
   * never reaching the server.
   */
  private async markCatalogueWriteFailed(
    write: PendingWrite,
    reason: string,
    result: { failed: number; errors: string[] }
  ): Promise<void> {
    const productName =
      (write.payload as { product?: { name?: string } } | undefined)?.product?.name ??
      "unknown product";

    console.error(
      `[Sync] ${write.type} for "${productName}" will not be retried — ${reason}. ` +
        `It stays on this device and has NOT reached the server.`
    );
    result.failed++;
    result.errors.push(`${write.type} ("${productName}"): ${reason}`);

    try {
      const { localDB } = await import("@/lib/db/localDB");
      await localDB.pending_writes.where("id").equals(write.id).modify((w: any) => {
        w.failed_permanently = true;
        w.last_error = reason;
      });
    } catch (e) {
      console.warn("[Sync] Could not mark the write as failed:", e);
    }
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
      (w) =>
        w.type === "register_create" ||
        w.type === "cash_shift_open" ||
        w.type === "cash_shift_close" ||
        w.type === "cash_adjustment"
    );
    // Products named at the till during an outage.
    const catalogueWrites = pendingWrites.filter((w) => w.type === "product_upsert");

    if (
      stockDecrements.length === 0 &&
      cashWrites.length === 0 &&
      catalogueWrites.length === 0
    ) {
      return result;
    }

    console.log(
      `[Sync] Processing ${stockDecrements.length} stock decrements + ` +
        `${cashWrites.length} cash ops + ${catalogueWrites.length} catalogue writes...`
    );

    // Catalogue writes first: a product created at the till is what a queued
    // sale's line items may refer to, so getting it to the server before the
    // sale is pushed keeps that reference resolvable.
    for (const write of catalogueWrites) {
      // Already judged unfixable — see the permanent branch below. Left in the
      // table on purpose rather than deleted.
      if (write.failed_permanently) continue;

      // Cap checked BEFORE the attempt, so a write that keeps failing for a
      // transient reason stops burning a request every 30 seconds forever.
      if ((write.retry_count ?? 0) >= MAX_PENDING_WRITE_RETRIES) {
        await this.markCatalogueWriteFailed(
          write,
          `gave up after ${write.retry_count} attempts (${write.last_error})`,
          result
        );
        logActivity("sync.write_dropped", {
          target: write.type,
          details: { id: write.id, attempts: write.retry_count, error: write.last_error, kept: true },
        });
        continue;
      }

      try {
        await this.processProductUpsertWrite(write);
        await removePendingWrite(write.id);
        result.processed++;
      } catch (error: any) {
        // A 4xx means the server LOOKED at this payload and refused it. Sending
        // the identical bytes again cannot change that answer, so retrying it
        // five times and then deleting it — which is what used to happen — just
        // delayed a silent data loss by two and a half minutes.
        // 408 and 429 are the exceptions: those are "not now", not "not ever".
        const status = error instanceof SyncHttpError ? error.status : 0;
        const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;

        if (permanent) {
          await this.markCatalogueWriteFailed(write, error.message, result);
          continue;
        }

        console.warn(`[Sync] ${write.type} failed, will retry:`, error.message);
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

    const supabase = createClient();

    // Process cash operations first (order matters).
    //
    // Within them, a register_create must be pushed BEFORE the cash_shift_open
    // that refers to it, or the shift insert fails its foreign key. Queue order
    // already achieves this — the register is queued first — but sort
    // defensively so a reordered or partially-drained queue cannot break it.
    cashWrites.sort(
      (a, b) =>
        (a.type === "register_create" ? 0 : 1) - (b.type === "register_create" ? 0 : 1)
    );

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
        logActivity("sync.write_dropped", {
          target: write.type,
          details: { id: write.id, attempts: write.retry_count, error: write.last_error, kept: false },
        });
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
        logActivity("sync.write_dropped", {
          target: write.type,
          details: { id: write.id, attempts: write.retry_count, error: write.last_error, kept: false },
        });
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
    const noop = {
      success: connectivity.isOnline,
      pulled: 0,
      pushed: 0,
      failed: 0,
      errors: [] as string[],
    };

    if (this.syncInProgress || !connectivity.isOnline) {
      return noop;
    }

    // Device-wide guard. syncInProgress only covers THIS tab; the queue is
    // shared across all of them. See withSyncLock.
    return withSyncLock(() => this.runSync(), noop);
  }

  /** The actual sync body. Only ever entered holding the cross-tab lock. */
  private async runSync(): Promise<{
    success: boolean;
    pulled: number;
    pushed: number;
    failed: number;
    errors: string[];
  }> {
    this.syncInProgress = true;
    this._status = "syncing";
    this.notify();

    // Stand the activity flusher down for the duration. Log delivery must
    // never compete with a queued sale reaching the server.
    setSyncBusy(true);
    const startedAt = Date.now();
    logActivity("sync.start");

    try {
      // MONEY FIRST.
      //
      // This used to run pullProducts() and the favourites pull before the
      // queue flush. After a multi-day outage the catalogue delta is large, so
      // the money-bearing writes waited behind a big download — on exactly the
      // fragile connection most likely to drop again mid-flush. Sales that
      // already happened outrank price updates that have not.
      const pushResult = await this.pushQueuedTransactions();

      // Products and favourites are independent of each other, so they overlap.
      const [pullResult] = await Promise.all([
        this.pullProducts(),
        this.storeId ? syncFavoritesFromSupabase(this.storeId) : Promise.resolve(),
      ]);

      // Process pending stock decrements (only for legacy/offline queued writes)
      const pendingResult = await this.processPendingWrites();

      // Process pending favorite writes (add/remove starred items)
      const favoriteResult = await processPendingFavoriteWrites();

      // `success` used to be `pullResult.success` alone, which meant the
      // indicator showed green while the queue was dead-lettering real sales.
      // A push failure is the more serious of the two and must be visible.
      const success =
        pullResult.success && pushResult.failed === 0 && pushResult.deadLettered === 0;

      // A flush cut short by the link dropping is this app's normal condition,
      // not an error state — the sales are safe and no retries were spent. Only
      // a genuine fault (a rejected payload, a failed pull) is worth alarming
      // the cashier about.
      const benignInterruption =
        pushResult.abortedOnTransient && pushResult.deadLettered === 0;
      this._status = success || benignInterruption ? "idle" : "error";
      this.notify();

      console.log(
        `[Sync] Complete: pushed ${pushResult.pushed} transactions` +
        (pushResult.deadLettered ? ` (${pushResult.deadLettered} DEAD-LETTERED)` : "") +
        (pushResult.abortedOnTransient ? " (flush cut short — link dropped)" : "") +
        `, pulled ${pullResult.count} products, ` +
        `processed ${pendingResult.processed} stock decrements, ` +
        `processed ${favoriteResult.processed} favorite writes`
      );

      // The row that answers "why has this sale not arrived". Fire and forget —
      // there is deliberately no await anywhere on this path.
      logActivity("sync.finish", {
        details: {
          success,
          duration_ms: Date.now() - startedAt,
          pushed: pushResult.pushed,
          dead_lettered: pushResult.deadLettered,
          aborted_on_transient: pushResult.abortedOnTransient,
          pulled: pullResult.count,
          pending_processed: pendingResult.processed,
          pending_failed: pendingResult.failed,
        },
      });

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
      logActivity("sync.finish", {
        details: {
          success: false,
          duration_ms: Date.now() - startedAt,
          error: error?.message || String(error),
        },
      });
      return {
        success: false,
        pulled: 0,
        pushed: 0,
        failed: 0,
        errors: [error.message],
      };
    } finally {
      this.syncInProgress = false;
      setSyncBusy(false);
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
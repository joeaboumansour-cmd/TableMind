/**
 * Sale completion: durability first, receipt instantly, server push in the
 * background.
 *
 * The old flow awaited `POST /api/transactions` before painting the receipt,
 * so the cashier and the customer stared at a spinner for the full network
 * round trip (2-5s on a serverless cold start) before the QR code appeared.
 * Nothing in the QR depends on the server — the receipt token is generated
 * locally — so that wait bought nothing.
 *
 * The order here is deliberate and load-bearing:
 *
 *   1. `queueCompletedSale()` writes the sale to `offline_queue` (IndexedDB,
 *      single-digit ms). THIS IS AWAITED ON THE CRITICAL PATH ON PURPOSE.
 *      A receipt must never be shown for a sale that exists only in React
 *      state — a crash or power cut at that moment would lose real money.
 *   2. The caller paints the receipt + QR.
 *   3. `pushSaleInBackground()` fires the server write with no await.
 *
 * Safety of the queue-first inversion rests on two existing properties:
 *   - `UNIQUE (store_id, transaction_number)` plus the `23505` branch in
 *     `POST /api/transactions` makes a double push a no-op, so this push
 *     racing the sync engine's 30s flush is harmless.
 *   - A row left in `offline_queue` is already the sync engine's job: it
 *     retries on reconnect, tab focus and the 30s interval, with the retry
 *     cap and dead-letter behaviour unchanged. Failure here degrades to
 *     exactly the old offline path.
 */

import type { QueuedTransaction } from "@/lib/db/localDB";
import { connectivity } from "@/lib/connectivity";

/** Bodies at or above this size cannot use `keepalive` (spec limit is 64KB). */
const KEEPALIVE_BODY_LIMIT = 60_000;

/**
 * Warm the Dexie chunk (and open the IndexedDB connection) ahead of time so
 * the first write of a sale is not also paying for a module fetch and a
 * database open. Safe to call on mount; failures are irrelevant because the
 * real call paths import it again anyway.
 */
export function warmLocalDB(): void {
  void import("@/lib/db/localDB").catch(() => {
    /* the real write path will surface any genuine problem */
  });
}

/**
 * Make the sale durable. Await this BEFORE showing the receipt.
 */
export async function queueCompletedSale(txn: QueuedTransaction): Promise<void> {
  const { queueTransaction } = await import("@/lib/db/localDB");
  await queueTransaction(txn);
}

/**
 * Push the sale to the server and update the local stock cache without
 * blocking the receipt. Never throws — a failure just leaves the queued row
 * for the sync engine.
 *
 * @param queuedId  `id` of the row written by `queueCompletedSale`. Removed
 *                  only after the server confirms, so an interrupted push
 *                  always leaves the sale recoverable.
 */
export function pushSaleInBackground(opts: {
  queuedId: string;
  payload: Record<string, unknown>;
  stockDecrements: Array<{ product_id: string; quantity: number }>;
}): void {
  void (async () => {
    // Local stock cache first: it is cheap, offline-safe, and the POS product
    // list reads from it, so the next scan sees the right quantity even if the
    // server push below never lands.
    try {
      const { decrementCachedStock } = await import("@/lib/db/localDB");
      await decrementCachedStock(opts.stockDecrements);
    } catch (e) {
      console.warn("[Sale] Failed to update cached stock:", e);
    }

    if (!connectivity.isOnline) {
      // Offline: the sync engine owns this row from here.
      //
      // The heartbeat, not navigator.onLine — the latter reports true on a
      // wifi network with no internet behind it, so this guard used to let the
      // push run anyway and wait out a request that could not succeed.
      return;
    }

    try {
      const authData = JSON.parse(
        localStorage.getItem("goldensquirrel_auth") || "{}"
      );
      const body = JSON.stringify(opts.payload);

      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-data": JSON.stringify({ store_id: authData.store_id }),
        },
        body,
        // Let the push survive the tab being closed right after the sale.
        // Over the limit the request would be rejected outright, so fall back
        // to a normal fetch (in-SPA navigation does not cancel it either way).
        keepalive: body.length < KEEPALIVE_BODY_LIMIT,
      });

      if (!response.ok) {
        throw new Error(`API error ${response.status}`);
      }

      const { removeQueuedTransaction } = await import("@/lib/db/localDB");
      await removeQueuedTransaction(opts.queuedId);
    } catch (error) {
      console.error(
        "[Sale] Background push failed; sale stays queued for sync:",
        error
      );
    }
  })();
}

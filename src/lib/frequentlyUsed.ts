// =============================================
// Frequently Used Products — Supabase + Local Storage
// =============================================
// Manages a per-store list of "frequently used" product IDs
// that are shown as quick-access buttons in desktop mode.
//
// Storage strategy:
//   1. localStorage is the instant-read cache (works offline, O(1) reads)
//   2. The `product_favorites` table is the source of truth, reached through
//      `/api/favorites` — see below
//   3. On toggle: write localStorage immediately, then attempt the server write
//   4. If offline / the write fails: queue as a pending write for later sync
//
// ## Why this no longer talks to Supabase directly
//
// All three calls here used to run in the BROWSER with the public Supabase
// client. That only works because `NEXT_PUBLIC_SUPABASE_ANON_KEY` currently
// holds a `service_role` JWT, which every visitor can read out of the bundle;
// a real anon key with RLS on returns nothing. This is step 2 of the same work
// that moved login server-side — the key cannot be swapped and the leaked one
// cannot be rotated while any of these reads remain client-side.
//
// The offline behaviour is deliberately unchanged: localStorage is still
// written first, and any failure — offline, 4xx, 5xx, a dropped connection —
// still queues a `favorite_add` / `favorite_remove` pending write. Both routes
// are idempotent so a replay converges.
// =============================================

import { addPendingWrite, removePendingWrite, getPendingWrites } from "@/lib/db/localDB";
import type { PendingWrite } from "@/lib/db/localDB";
import { connectivity } from "@/lib/connectivity";
// `@/lib/auth/apiHeaders`, not `@/lib/auth/requestHeaders`: /api/favorites is
// resolveCaller()-gated and rejects a header with no `user_id`, which
// requestHeaders omits for the owner.
import { buildAuthHeaders, getStoreId } from "@/lib/auth/apiHeaders";

const STORAGE_KEY_PREFIX = "tm_frequently_used_";

// There is deliberately NO cap on how many products can be starred.
//
// This used to be MAX_FREQUENTLY_USED = 12, applied with slice(0, 12) both on
// add and after the Supabase merge. Starring a 13th product silently evicted
// the oldest from the grid, so stars appeared to "replace each other" — and
// worse, the eviction was LOCAL ONLY: the favourite still existed in
// product_favorites, so the next merge could bring it back and drop a
// different one. A shop with 30 quick items could never see more than 12 of
// them, and which 12 changed under them.
//
// The grid these feed (QuickGrid) scrolls, so the list length is a display
// concern rather than a storage one. The ids are UUIDs — even several hundred
// is a few KB of localStorage.

// Matches MAX_PENDING_WRITE_RETRIES in the sync engine. Kept local to avoid a
// circular import (the engine imports this module).
const MAX_FAVORITE_WRITE_RETRIES = 5;
const SYNCED_KEY_PREFIX = "tm_favorites_synced_";

/**
 * Get the list of frequently used product IDs for a store (from localStorage cache).
 */
export function getFrequentlyUsedProductIds(storeId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `${STORAGE_KEY_PREFIX}${storeId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Add a product to the frequently used list (moves to front if already present).
 * Writes to localStorage immediately and attempts Supabase persistence.
 */
export function addFrequentlyUsedProduct(storeId: string, productId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_KEY_PREFIX}${storeId}`;
    const ids = getFrequentlyUsedProductIds(storeId);
    if (!ids.includes(productId)) {
      ids.unshift(productId);
      localStorage.setItem(key, JSON.stringify(ids));
    }
  } catch {
    // Ignore errors
  }

  // Persist to Supabase (fire-and-forget, queue if offline)
  void persistFavoriteAdd(storeId, productId);
}

/**
 * Remove a product from the frequently used list.
 * Writes to localStorage immediately and attempts Supabase persistence.
 */
export function removeFrequentlyUsedProduct(storeId: string, productId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_KEY_PREFIX}${storeId}`;
    const ids = getFrequentlyUsedProductIds(storeId);
    const filtered = ids.filter((id) => id !== productId);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {
    // Ignore errors
  }

  // Persist to Supabase (fire-and-forget, queue if offline)
  void persistFavoriteRemove(storeId, productId);
}

/**
 * Check if a product is in the frequently used list.
 */
export function isFrequentlyUsed(storeId: string, productId: string): boolean {
  return getFrequentlyUsedProductIds(storeId).includes(productId);
}

// =============================================
// Server Persistence (/api/favorites)
// =============================================

/**
 * Push one favourite change to the server.
 *
 * Throws on anything that is not a 2xx, so both callers below fall into the
 * same "queue it" branch they already had. The route is idempotent on both
 * verbs, so a queued write replayed twice is not a problem.
 *
 * `store_id` is NOT sent: the route takes it from the resolved caller, so a
 * favourite can only ever be written into the caller's own store.
 */
async function pushFavorite(
  type: "favorite_add" | "favorite_remove",
  productId: string
): Promise<void> {
  const response =
    type === "favorite_add"
      ? await fetch("/api/favorites", {
          method: "POST",
          headers: buildAuthHeaders(),
          body: JSON.stringify({ product_id: productId }),
        })
      : await fetch(`/api/favorites?product_id=${encodeURIComponent(productId)}`, {
          method: "DELETE",
          headers: buildAuthHeaders(),
        });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
}

/**
 * Add a favorite on the server. If offline or the write fails, queue it
 * as a pending write for later sync.
 */
async function persistFavoriteAdd(storeId: string, productId: string): Promise<void> {
  if (typeof window === "undefined" || !connectivity.isOnline) {
    await queueFavoriteWrite("favorite_add", storeId, productId);
    return;
  }

  try {
    await pushFavorite("favorite_add", productId);
  } catch (err) {
    console.warn("[Favorites] Failed to persist add, queuing:", err);
    await queueFavoriteWrite("favorite_add", storeId, productId);
  }
}

/**
 * Remove a favorite on the server. If offline or the write fails, queue it
 * as a pending write for later sync.
 */
async function persistFavoriteRemove(storeId: string, productId: string): Promise<void> {
  if (typeof window === "undefined" || !connectivity.isOnline) {
    await queueFavoriteWrite("favorite_remove", storeId, productId);
    return;
  }

  try {
    await pushFavorite("favorite_remove", productId);
  } catch (err) {
    console.warn("[Favorites] Failed to persist remove, queuing:", err);
    await queueFavoriteWrite("favorite_remove", storeId, productId);
  }
}

/**
 * Queue a favorite add/remove as a pending write in IndexedDB.
 * The sync engine will process these when back online.
 */
async function queueFavoriteWrite(
  type: "favorite_add" | "favorite_remove",
  storeId: string,
  productId: string
): Promise<void> {
  try {
    const pendingWrite: PendingWrite = {
      id: crypto.randomUUID(),
      type,
      payload: { store_id: storeId, product_id: productId },
      created_at: new Date().toISOString(),
      retry_count: 0,
      last_error: null,
    };
    await addPendingWrite(pendingWrite);
  } catch (err) {
    console.error("[Favorites] Failed to queue pending write:", err);
  }
}

/**
 * Pull favorites from the server and merge into localStorage.
 * Called on app startup / login to sync favorites across devices.
 *
 * Merge strategy: union of the server's favorites and existing localStorage,
 * preserving localStorage order (server items appended if not present).
 * This avoids losing locally-cached favorites if the pull fails partially.
 *
 * The name is kept (the sync engine imports it) even though the read now goes
 * through `/api/favorites` rather than the browser's Supabase client.
 */
export async function syncFavoritesFromSupabase(storeId: string): Promise<void> {
  if (typeof window === "undefined" || !connectivity.isOnline) return;

  // The route answers for the SIGNED-IN store, not for a store id passed in,
  // so merging its answer into another store's key would be wrong. Every
  // caller passes the current session's store; this only guards a device that
  // has served two stores.
  if (getStoreId() !== storeId) return;

  try {
    const response = await fetch("/api/favorites", { headers: buildAuthHeaders() });
    if (!response.ok) throw new Error(`API error ${response.status}`);
    const payload = (await response.json()) as { product_ids?: string[] };

    // A malformed answer must not read as "the store has no favourites" —
    // that would wipe the local list below. Same rule as evaluateReconcile():
    // deletion needs positive proof.
    if (!Array.isArray(payload?.product_ids)) {
      throw new Error("Malformed favourites response");
    }

    const remoteIds = payload.product_ids;
    const localIds = getFrequentlyUsedProductIds(storeId);

    // CRITICAL FIX: Remove local IDs that no longer exist remotely.
    // This cleans up favorites for products that were deleted.
    // Only keep local IDs that are still in the remote set.
    const remoteSet = new Set(remoteIds);
    const validLocalIds = localIds.filter((id) => remoteSet.has(id));

    // Merge: keep local order, append any remote-only IDs
    const merged = [...validLocalIds];
    for (const remoteId of remoteIds) {
      if (!merged.includes(remoteId)) {
        merged.push(remoteId);
      }
    }

    localStorage.setItem(`${STORAGE_KEY_PREFIX}${storeId}`, JSON.stringify(merged));

    // Mark as synced so callers know localStorage is up-to-date
    localStorage.setItem(`${SYNCED_KEY_PREFIX}${storeId}`, Date.now().toString());

    console.log(`[Favorites] Synced ${remoteIds.length} favorites from Supabase (merged: ${merged.length})`);
  } catch (err) {
    console.warn("[Favorites] Failed to sync from Supabase:", err);
  }
}

/**
 * Process queued favorite writes (add/remove) from the pending_writes table.
 * Called by the sync engine during syncNow().
 */
export async function processPendingFavoriteWrites(): Promise<{
  processed: number;
  failed: number;
  errors: string[];
}> {
  const result = { processed: 0, failed: 0, errors: [] as string[] };

  const allPending = await getPendingWrites();
  const favoriteWrites = allPending.filter(
    (w): w is PendingWrite & { type: "favorite_add" | "favorite_remove" } =>
      w.type === "favorite_add" || w.type === "favorite_remove"
  );

  if (favoriteWrites.length === 0) {
    return result;
  }

  console.log(`[Favorites] Processing ${favoriteWrites.length} pending favorite writes...`);

  // `/api/favorites` writes into the SIGNED-IN store. A write queued under a
  // different store — a till that has served two — can no longer be told apart
  // from one for this store once it reaches the route, so it is dropped rather
  // than applied to the wrong tenant. A star is cosmetic; a favourite written
  // into someone else's catalogue is not.
  const sessionStoreId = getStoreId();

  for (const write of favoriteWrites) {
    // Favorite writes incremented retry_count but never checked it, so a
    // permanently-failing favourite retried every 30s indefinitely. A
    // favourite is cosmetic, so dropping it past the cap is safe.
    if ((write.retry_count ?? 0) >= MAX_FAVORITE_WRITE_RETRIES) {
      console.error(
        `[Favorites] Dropping ${write.type} ${write.id} after ${write.retry_count} retries: ${write.last_error}`
      );
      await removePendingWrite(write.id);
      result.failed++;
      result.errors.push(
        `Favorite ${write.type} ${write.id}: dropped after ${write.retry_count} retries (${write.last_error})`
      );
      continue;
    }

    const payload = write.payload as { store_id: string; product_id: string };

    // No session at all is not proof of anything — leave the write queued and
    // try again once someone is signed in.
    if (!sessionStoreId) continue;

    if (payload.store_id !== sessionStoreId) {
      console.warn(
        `[Favorites] Dropping ${write.type} ${write.id}: queued for store ${payload.store_id}, session is ${sessionStoreId}`
      );
      await removePendingWrite(write.id);
      result.failed++;
      result.errors.push(`Favorite ${write.type} ${write.id}: queued for a different store`);
      continue;
    }

    try {
      await pushFavorite(write.type, payload.product_id);

      await removePendingWrite(write.id);
      result.processed++;
      console.log(`[Favorites] Processed ${write.type} for product ${payload.product_id}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Favorites] Failed to process ${write.type} ${write.id}:`, error);
      result.failed++;
      result.errors.push(`Favorite ${write.type} ${write.id}: ${message}`);

      // Update retry count
      try {
        const { localDB } = await import("@/lib/db/localDB");
        await localDB.pending_writes
          .where("id")
          .equals(write.id)
          .modify((w) => {
            w.retry_count = (w.retry_count ?? 0) + 1;
            w.last_error = message;
          });
      } catch (e) {
        console.warn("[Favorites] Failed to update retry count:", e);
      }
    }
  }

  return result;
}
// =============================================
// Frequently Used Products — Supabase + Local Storage
// =============================================
// Manages a per-store list of "frequently used" product IDs
// that are shown as quick-access buttons in desktop mode.
//
// Storage strategy:
//   1. localStorage is the instant-read cache (works offline, O(1) reads)
//   2. Supabase `product_favorites` table is the source of truth
//   3. On toggle: write localStorage immediately, then attempt Supabase write
//   4. If offline / Supabase fails: queue as a pending write for later sync
// =============================================

import { createClient } from "@/lib/supabase/client";
import { addPendingWrite, removePendingWrite, getPendingWrites } from "@/lib/db/localDB";
import type { PendingWrite } from "@/lib/db/localDB";

const STORAGE_KEY_PREFIX = "tm_frequently_used_";
const MAX_FREQUENTLY_USED = 12;
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
      const trimmed = ids.slice(0, MAX_FREQUENTLY_USED);
      localStorage.setItem(key, JSON.stringify(trimmed));
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
// Supabase Persistence
// =============================================

/**
 * Add a favorite to Supabase. If offline or the write fails, queue it
 * as a pending write for later sync.
 */
async function persistFavoriteAdd(storeId: string, productId: string): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) {
    await queueFavoriteWrite("favorite_add", storeId, productId);
    return;
  }

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("product_favorites")
      .insert({ store_id: storeId, product_id: productId });

    if (error) {
      // Ignore duplicate errors (23505 = unique_violation) — already favorited
      if (error.code !== "23505") {
        throw error;
      }
    }
  } catch (err) {
    console.warn("[Favorites] Failed to persist add, queuing:", err);
    await queueFavoriteWrite("favorite_add", storeId, productId);
  }
}

/**
 * Remove a favorite from Supabase. If offline or the write fails, queue it
 * as a pending write for later sync.
 */
async function persistFavoriteRemove(storeId: string, productId: string): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) {
    await queueFavoriteWrite("favorite_remove", storeId, productId);
    return;
  }

  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("product_favorites")
      .delete()
      .eq("store_id", storeId)
      .eq("product_id", productId);

    if (error) throw error;
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
 * Pull favorites from Supabase and merge into localStorage.
 * Called on app startup / login to sync favorites across devices.
 *
 * Merge strategy: union of Supabase favorites and existing localStorage,
 * preserving localStorage order (Supabase items appended if not present).
 * This avoids losing locally-cached favorites if the pull fails partially.
 */
export async function syncFavoritesFromSupabase(storeId: string): Promise<void> {
  if (typeof window === "undefined" || !navigator.onLine) return;

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("product_favorites")
      .select("product_id, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const remoteIds = (data || []).map((row: { product_id: string }) => row.product_id);
    const localIds = getFrequentlyUsedProductIds(storeId);

    // Merge: keep local order, append any remote-only IDs
    const merged = [...localIds];
    for (const remoteId of remoteIds) {
      if (!merged.includes(remoteId)) {
        merged.push(remoteId);
      }
    }

    const trimmed = merged.slice(0, MAX_FREQUENTLY_USED);
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${storeId}`, JSON.stringify(trimmed));

    // Mark as synced so callers know localStorage is up-to-date
    localStorage.setItem(`${SYNCED_KEY_PREFIX}${storeId}`, Date.now().toString());

    console.log(`[Favorites] Synced ${remoteIds.length} favorites from Supabase (merged: ${trimmed.length})`);
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
    (w) => w.type === "favorite_add" || w.type === "favorite_remove"
  );

  if (favoriteWrites.length === 0) {
    return result;
  }

  console.log(`[Favorites] Processing ${favoriteWrites.length} pending favorite writes...`);

  const supabase = createClient();

  for (const write of favoriteWrites) {
    try {
      const payload = write.payload as { store_id: string; product_id: string };

      if (write.type === "favorite_add") {
        const { error } = await supabase
          .from("product_favorites")
          .insert({ store_id: payload.store_id, product_id: payload.product_id });

        if (error && error.code !== "23505") {
          throw new Error(error.message || "Favorite add failed");
        }
      } else if (write.type === "favorite_remove") {
        const { error } = await supabase
          .from("product_favorites")
          .delete()
          .eq("store_id", payload.store_id)
          .eq("product_id", payload.product_id);

        if (error) throw new Error(error.message || "Favorite remove failed");
      }

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
            w.retry_count += 1;
            w.last_error = message;
          });
      } catch (e) {
        console.warn("[Favorites] Failed to update retry count:", e);
      }
    }
  }

  return result;
}
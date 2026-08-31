"use client";

// =============================================
// Product categories — the local copy
// =============================================
// Categories cache in localStorage, NOT in Dexie, and that is deliberate:
//
//  * The rail wants them SYNCHRONOUSLY on first paint. localStorage is a sync
//    read; Dexie is not.
//  * There are tens of rows, not thousands.
//  * A stale copy degrades to "an extra empty tab", never to lost money — so
//    this does not need the reconcile machinery that products need. Compare
//    `reconcileProductsCache`, where deleting on partial evidence is unsafe.
//  * Dexie versions are append-only forever, and nothing here needs an index.
//    Do not spend a `db.version(5)` on this.
//
// Same pattern, and the same reasoning, as `store_features_${storeId}`.
// =============================================

import { type Category, compareCategories } from "./types";

function key(storeId: string): string {
  return `store_categories_${storeId}`;
}

/**
 * Has this store's rail EVER been written to this device?
 *
 * The cache KEY's existence, deliberately NOT "the list is non-empty": a shop
 * can genuinely have no categories, which is an answer, while a device that has
 * never loaded them has none. Conflating the two is the shape of audit P1-12.
 */
export function hasCachedCategories(storeId: string): boolean {
  if (typeof window === "undefined" || !storeId) return false;
  try {
    return window.localStorage.getItem(key(storeId)) !== null;
  } catch {
    return false;
  }
}

/**
 * The cached categories for a store, in display order.
 *
 * Returns [] for anything unreadable or malformed rather than throwing: a
 * broken cache must degrade to "no rail", never to a broken till.
 */
export function readCachedCategories(storeId: string): Category[] {
  if (typeof window === "undefined" || !storeId) return [];
  try {
    const raw = window.localStorage.getItem(key(storeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is Category =>
          !!c &&
          typeof c.id === "string" &&
          typeof c.name === "string" &&
          typeof c.sort_order === "number"
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        sort_order: c.sort_order,
        color: typeof c.color === "string" ? c.color : null,
      }))
      .sort(compareCategories);
  } catch {
    return [];
  }
}

/** Replace the cached list. Never throws — a full disk must not break a sale. */
export function writeCachedCategories(storeId: string, categories: Category[]): void {
  if (typeof window === "undefined" || !storeId) return;
  try {
    window.localStorage.setItem(key(storeId), JSON.stringify(categories));
  } catch (error) {
    // Quota, private mode, or a disabled store. The rail falls back to whatever
    // is already cached, or to no rail. Nothing about selling depends on this.
    console.warn("[Categories] Could not cache categories:", error);
  }
}

/**
 * Drop the cached list for one store.
 *
 * NOTE: logout does NOT call this — `clearUserFromStorage()` in
 * AuthContext.tsx clears every `store_categories_` key by prefix, because at
 * that point it is clearing whatever any store left behind, not one known id.
 * The reason is the same one that clears the cash snapshot there: the next
 * person to sign in on this device must not see the last store's data.
 */
export function clearCachedCategories(storeId: string): void {
  if (typeof window === "undefined" || !storeId) return;
  try {
    window.localStorage.removeItem(key(storeId));
  } catch {
    // Nothing to do — a categories list we cannot clear is not worth failing on.
  }
}

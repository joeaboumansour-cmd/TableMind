"use client";

// =============================================
// Product categories — loading
// =============================================
// The "paint from cache first, then revalidate" pattern the transactions page
// and the cash page already use. The rail must be there on the first frame,
// with no internet, so the cached copy is authoritative for rendering and the
// network result only ever replaces it.
// =============================================

import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { compareCategories, type Category } from "./types";
import { readCachedCategories, writeCachedCategories } from "./store";

/**
 * IMPORTANT: `@/lib/auth/apiHeaders`, not `@/lib/auth/requestHeaders`.
 *
 * /api/categories resolves the caller with `resolveCaller()`, which REJECTS a
 * header carrying no `user_id`. requestHeaders deliberately omits `user_id` for
 * an owner (their id is the store id), so using it here would 401 the owner —
 * i.e. it would work for employees and fail for the person who set the shop up.
 */

/** One in-flight refresh per store, mirroring refreshProductsIntoCache(). */
const inFlight = new Map<string, Promise<Category[]>>();

/** The cached list, synchronously. Safe on first paint and with no internet. */
export function getCategories(storeId: string): Category[] {
  return readCachedCategories(storeId);
}

/**
 * Fetch categories and update the cache.
 *
 * Never throws and never clears the cache on failure: an offline till keeps
 * the rail it already had. Returns whatever the caller should render — the
 * fresh list on success, the cached one otherwise.
 */
export async function refreshCategories(storeId: string): Promise<Category[]> {
  if (!storeId) return [];

  const existing = inFlight.get(storeId);
  if (existing) return existing;

  const run = (async (): Promise<Category[]> => {
    try {
      const response = await fetch(
        `/api/categories?store_id=${encodeURIComponent(storeId)}`,
        { headers: buildAuthHeaders() }
      );
      if (!response.ok) throw new Error(`API error ${response.status}`);

      const body = (await response.json()) as { categories?: unknown };
      if (!Array.isArray(body.categories)) throw new Error("Malformed response");

      const categories = (body.categories as Category[]).slice().sort(compareCategories);
      writeCachedCategories(storeId, categories);
      return categories;
    } catch (error) {
      // Offline, or the route is unhappy. The rail keeps whatever it had —
      // deliberately NOT cleared, on the same principle as the product
      // reconcile: removing things requires positive evidence, and skipping is
      // always safe.
      console.warn("[Categories] Refresh failed; keeping the cached list:", error);
      return readCachedCategories(storeId);
    } finally {
      inFlight.delete(storeId);
    }
  })();

  inFlight.set(storeId, run);
  return run;
}

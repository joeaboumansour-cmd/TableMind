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
import { connectivity } from "@/lib/connectivity";
import { refreshResource, type ResourceDefinition } from "@/lib/data/resource";
import { compareCategories, type Category } from "./types";
import { hasCachedCategories, readCachedCategories, writeCachedCategories } from "./store";

/**
 * IMPORTANT: `@/lib/auth/apiHeaders`, not `@/lib/auth/requestHeaders`.
 *
 * /api/categories resolves the caller with `resolveCaller()`, which REJECTS a
 * header carrying no `user_id`. requestHeaders deliberately omits `user_id` for
 * an owner (their id is the store id), so using it here would 401 the owner —
 * i.e. it would work for employees and fail for the person who set the shop up.
 */

/**
 * The rail is a display convenience that changes a few times a week, so a
 * screen that has already fetched it this session should not fetch it again on
 * the way back. /pos and /pos/products between them used to cost two requests
 * for exactly that.
 */
const CATEGORIES_STALE_MS = 60_000;

/** Stable empty reference — see ResourceDefinition.empty. */
const NO_CATEGORIES: Category[] = [];

/**
 * The categories resource.
 *
 * `fetch` REJECTS on failure, unlike the loader this replaced. Keeping the
 * cached list on a failed refresh is still the behaviour — it just happens in
 * `refreshResource` now, where it can also record the error and leave
 * `hydrated` alone. Removing things requires positive evidence; skipping is
 * always safe.
 */
export const categoriesResource: ResourceDefinition<Category[]> = {
  name: "categories",
  empty: NO_CATEGORIES,
  read: readCachedCategories,
  has: hasCachedCategories,
  write: writeCachedCategories,
  staleTime: CATEGORIES_STALE_MS,
  isOnline: () => connectivity.isOnline,

  async fetch(storeId: string): Promise<Category[]> {
    // IMPORTANT: `@/lib/auth/apiHeaders`, not `@/lib/auth/requestHeaders`.
    // See the note at the top of this file.
    const response = await fetch(
      `/api/categories?store_id=${encodeURIComponent(storeId)}`,
      { headers: buildAuthHeaders() }
    );
    if (!response.ok) throw new Error(`API error ${response.status}`);

    const body = (await response.json()) as { categories?: unknown };
    if (!Array.isArray(body.categories)) throw new Error("Malformed response");

    return (body.categories as Category[]).slice().sort(compareCategories);
  },
};

/**
 * Fetch categories and update the cache.
 *
 * The one caller left is `CategoryManagerDialog`, which calls this straight
 * after creating, renaming, reordering or deleting a category. `force` is the
 * point: a re-read that the stale window could answer would show the list as
 * it was BEFORE the edit the user just made.
 *
 * It writes through the resource, so the inventory page behind the dialog and
 * the till's rail both update without being told — which is why the dialog no
 * longer has an `onCategoriesChange` prop.
 */
export async function refreshCategories(storeId: string): Promise<Category[]> {
  if (!storeId) return NO_CATEGORIES;
  const state = await refreshResource(categoriesResource, storeId, { force: true });
  return state.data;
}

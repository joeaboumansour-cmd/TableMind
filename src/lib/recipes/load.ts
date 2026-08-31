"use client";

// =============================================
// Recipes — the local copy
// =============================================
// Cached in localStorage, not Dexie, for the same reasons as categories: the
// modifier sheet must open instantly with no internet, the volume is small
// (a snack shop is ~640 rows / ~60KB), and Dexie versions are append-only
// forever so a bump should be spent on something that needs an index.
//
// Promote to Dexie only past ~2,000 components.
// =============================================

import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { connectivity } from "@/lib/connectivity";
import { refreshResource, writeResource, type ResourceDefinition } from "@/lib/data/resource";
import { compareComponents, type RecipeComponent, type RecipeMap } from "./types";

function key(storeId: string): string {
  return `store_recipes_${storeId}`;
}

/**
 * Have this store's recipes EVER been written to this device?
 *
 * Deliberately distinct from `getCachedRecipes()` returning an empty map. A
 * store can have `menu_items` on and no recipes authored, which is a real
 * answer; a device that has never loaded them has no answer at all. Treating
 * those as the same thing is audit P1-12.
 *
 * The KEY's existence is the proof, because `writeCachedRecipes()` runs only
 * after a successful fetch — and `refreshRecipes()` cannot be used for this,
 * since it catches its own errors and RESOLVES with the cached copy, so a
 * failed refresh is indistinguishable from a successful one at the call site.
 */
export function hasCachedRecipes(storeId: string): boolean {
  if (typeof window === "undefined" || !storeId) return false;
  try {
    return window.localStorage.getItem(key(storeId)) !== null;
  } catch {
    return false;
  }
}

/**
 * The cached recipes, synchronously. Returns {} for anything unreadable — a
 * broken cache must degrade to "no modifiers", never to a broken till.
 */
export function getCachedRecipes(storeId: string): RecipeMap {
  if (typeof window === "undefined" || !storeId) return {};
  try {
    const raw = window.localStorage.getItem(key(storeId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: RecipeMap = {};
    for (const [productId, components] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(components)) continue;
      const clean = components
        .filter(
          (c): c is RecipeComponent =>
            !!c &&
            typeof c.id === "string" &&
            typeof c.ingredient_product_id === "string" &&
            Number.isFinite(Number(c.quantity))
        )
        .map((c) => ({
          ...c,
          quantity: Number(c.quantity),
          price_delta_ll: Number(c.price_delta_ll) || 0,
          max_quantity: Number(c.max_quantity) || 1,
        }))
        .sort(compareComponents);
      if (clean.length > 0) out[productId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Never throws — a full disk must not break a sale. */
export function writeCachedRecipes(storeId: string, recipes: RecipeMap): void {
  if (typeof window === "undefined" || !storeId) return;
  try {
    window.localStorage.setItem(key(storeId), JSON.stringify(recipes));
  } catch (error) {
    console.warn("[Recipes] Could not cache recipes:", error);
  }
}

/**
 * Recipes change when the owner edits a menu, which is rare, so a screen that
 * has already fetched them this session should not fetch them again.
 */
const RECIPES_STALE_MS = 60_000;

/** Stable empty reference — see ResourceDefinition.empty. */
const NO_RECIPES: RecipeMap = {};

/**
 * The recipes resource.
 *
 * This is the one audit P1-12 is about. `hydrated` — driven by
 * `hasCachedRecipes` — is what finally distinguishes "this shop has no recipes"
 * from "this device has never been told", and a failed fetch leaves it alone.
 */
export const recipesResource: ResourceDefinition<RecipeMap> = {
  name: "recipes",
  empty: NO_RECIPES,
  read: getCachedRecipes,
  has: hasCachedRecipes,
  write: writeCachedRecipes,
  staleTime: RECIPES_STALE_MS,
  isOnline: () => connectivity.isOnline,

  // No `storeId` parameter: /api/recipes reads the tenant from the auth header
  // via resolveCaller(), not from the URL, so taking one here would imply a
  // scoping choice this call does not actually make.
  async fetch(): Promise<RecipeMap> {
    const response = await fetch("/api/recipes", { headers: buildAuthHeaders() });
    if (!response.ok) throw new Error(`API error ${response.status}`);

    const body = (await response.json()) as { recipes?: RecipeMap; truncated?: boolean };
    if (!body.recipes || typeof body.recipes !== "object") throw new Error("Malformed response");

    // A truncated list would silently under-deduct stock on whatever fell off
    // the end. REJECT rather than adopt a partial one — the store then keeps
    // the previous copy, same as any other failure, and the reason is visible
    // in `error` instead of only in the console.
    if (body.truncated) {
      console.error("[Recipes] Server reported a truncated recipe set; keeping the cached copy");
      throw new Error("Truncated recipe set");
    }

    return body.recipes;
  },
};

/**
 * Fetch recipes and update the cache.
 *
 * Kept at its old signature — never throws, resolves with whatever the caller
 * should render — for /pos/products, which moves to `useResource` in Phase 3.3.
 * It DELEGATES rather than duplicating, so there is one in-flight map. `force`
 * keeps this path behaving exactly as it did before.
 */
export async function refreshRecipes(storeId: string): Promise<RecipeMap> {
  if (!storeId) return NO_RECIPES;
  const state = await refreshResource(recipesResource, storeId, { force: true });
  return state.data;
}

/** Replace one product's recipe on the server, then update the cache. */
export async function saveRecipe(
  storeId: string,
  menuProductId: string,
  components: Array<Omit<RecipeComponent, "id" | "menu_product_id">>
): Promise<RecipeComponent[]> {
  const response = await fetch("/api/recipes", {
    method: "PUT",
    headers: buildAuthHeaders(),
    body: JSON.stringify({ menu_product_id: menuProductId, components }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Could not save the recipe" }));
    throw new Error(body.error || `API error ${response.status}`);
  }

  const body = (await response.json()) as { components: RecipeComponent[] };
  const saved = body.components || [];

  // Through the resource, not straight to localStorage: a till subscribed via
  // useResource must see an edited recipe without a reload.
  const cache = { ...getCachedRecipes(storeId) };
  if (saved.length > 0) cache[menuProductId] = saved;
  else delete cache[menuProductId];
  writeResource(recipesResource, storeId, cache);

  return saved;
}

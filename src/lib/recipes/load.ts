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
import { compareComponents, type RecipeComponent, type RecipeMap } from "./types";

function key(storeId: string): string {
  return `store_recipes_${storeId}`;
}

/** One in-flight refresh per store, mirroring refreshProductsIntoCache(). */
const inFlight = new Map<string, Promise<RecipeMap>>();

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
 * Fetch recipes and update the cache.
 *
 * Never throws, and never clears the cache on failure: an offline till keeps
 * the recipes it already had. Same rule as the product reconcile — removing
 * things requires positive evidence, and skipping is always safe.
 */
export async function refreshRecipes(storeId: string): Promise<RecipeMap> {
  if (!storeId) return {};

  const existing = inFlight.get(storeId);
  if (existing) return existing;

  const run = (async (): Promise<RecipeMap> => {
    try {
      const response = await fetch("/api/recipes", { headers: buildAuthHeaders() });
      if (!response.ok) throw new Error(`API error ${response.status}`);

      const body = (await response.json()) as { recipes?: RecipeMap; truncated?: boolean };
      if (!body.recipes || typeof body.recipes !== "object") throw new Error("Malformed response");

      // A truncated list would silently under-deduct stock on whatever fell off
      // the end. Keep the previous copy rather than adopting a partial one.
      if (body.truncated) {
        console.error("[Recipes] Server reported a truncated recipe set; keeping the cached copy");
        return getCachedRecipes(storeId);
      }

      writeCachedRecipes(storeId, body.recipes);
      return body.recipes;
    } catch (error) {
      console.warn("[Recipes] Refresh failed; keeping the cached copy:", error);
      return getCachedRecipes(storeId);
    } finally {
      inFlight.delete(storeId);
    }
  })();

  inFlight.set(storeId, run);
  return run;
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

  const cache = getCachedRecipes(storeId);
  if (saved.length > 0) cache[menuProductId] = saved;
  else delete cache[menuProductId];
  writeCachedRecipes(storeId, cache);

  return saved;
}

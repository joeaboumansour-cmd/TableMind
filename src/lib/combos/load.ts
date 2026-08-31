"use client";

// =============================================
// Combos — the local copy
// =============================================
// localStorage, not Dexie, for the same reasons as categories and recipes: the
// till must know what a meal contains on the first frame with no internet, the
// volume is tiny, and a Dexie version is append-only forever and should be
// spent on something that needs an index.
// =============================================

import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { connectivity } from "@/lib/connectivity";
import { refreshResource, writeResource, type ResourceDefinition } from "@/lib/data/resource";
import { compareComboComponents, type ComboComponent, type ComboMap } from "./types";

function key(storeId: string): string {
  return `store_combos_${storeId}`;
}

/** The cached combos, synchronously. {} for anything unreadable. */
export function getCachedCombos(storeId: string): ComboMap {
  if (typeof window === "undefined" || !storeId) return {};
  try {
    const raw = window.localStorage.getItem(key(storeId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: ComboMap = {};
    for (const [comboId, items] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      const clean = items
        .filter(
          (c): c is ComboComponent =>
            !!c &&
            typeof c.id === "string" &&
            typeof c.item_product_id === "string" &&
            Number.isFinite(Number(c.quantity))
        )
        .map((c) => ({ ...c, quantity: Number(c.quantity) || 1 }))
        .sort(compareComboComponents);
      if (clean.length > 0) out[comboId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Never throws — a full disk must not break a sale. */
export function writeCachedCombos(storeId: string, combos: ComboMap): void {
  if (typeof window === "undefined" || !storeId) return;
  try {
    window.localStorage.setItem(key(storeId), JSON.stringify(combos));
  } catch (error) {
    console.warn("[Combos] Could not cache combos:", error);
  }
}

/**
 * Has this store's combos EVER been written to this device?
 *
 * The cache KEY's existence, not the map's size — a shop can genuinely sell no
 * meals. See `hasCachedRecipes` for the full reasoning; this is audit P1-12's
 * distinction applied to the other half of the menu.
 */
export function hasCachedCombos(storeId: string): boolean {
  if (typeof window === "undefined" || !storeId) return false;
  try {
    return window.localStorage.getItem(key(storeId)) !== null;
  } catch {
    return false;
  }
}

/** Combos change when the owner edits the menu. Rare. */
const COMBOS_STALE_MS = 60_000;

/** Stable empty reference — see ResourceDefinition.empty. */
const NO_COMBOS: ComboMap = {};

/**
 * The combos resource.
 *
 * A combo that is not yet known is rung up as a plain product — one line at the
 * meal's own price with none of its children, so nothing reaches the kitchen
 * and no ingredient is deducted. Exactly the P1-12 failure, which is why this
 * gets the same treatment as recipes rather than being left behind.
 */
export const combosResource: ResourceDefinition<ComboMap> = {
  name: "combos",
  empty: NO_COMBOS,
  read: getCachedCombos,
  has: hasCachedCombos,
  write: writeCachedCombos,
  staleTime: COMBOS_STALE_MS,
  isOnline: () => connectivity.isOnline,

  // No `storeId` parameter: /api/combos reads the tenant from the auth header
  // via resolveCaller(), not from the URL, so taking one here would imply a
  // scoping choice this call does not actually make.
  async fetch(): Promise<ComboMap> {
    const response = await fetch("/api/combos", { headers: buildAuthHeaders() });
    if (!response.ok) throw new Error(`API error ${response.status}`);

    const body = (await response.json()) as { combos?: ComboMap; truncated?: boolean };
    if (!body.combos || typeof body.combos !== "object") throw new Error("Malformed response");

    // A truncated set would sell a meal missing half its contents and
    // under-deplete stock. REJECT rather than adopt it; the store keeps the
    // previous copy, on the same rule as the product reconcile.
    if (body.truncated) {
      console.error("[Combos] Server reported a truncated set; keeping the cached copy");
      throw new Error("Truncated combo set");
    }

    return body.combos;
  },
};

/**
 * Fetch combos and update the cache.
 *
 * Kept at its old signature for /pos/products (Phase 3.3). Delegates rather
 * than duplicating, so there is one in-flight map; `force` keeps this path
 * behaving exactly as it did before.
 */
export async function refreshCombos(storeId: string): Promise<ComboMap> {
  if (!storeId) return NO_COMBOS;
  const state = await refreshResource(combosResource, storeId, { force: true });
  return state.data;
}

/** Replace one combo on the server, then update the cache. */
export async function saveCombo(
  storeId: string,
  comboProductId: string,
  components: Array<{ item_product_id: string; quantity: number; sort_order: number }>
): Promise<ComboComponent[]> {
  const response = await fetch("/api/combos", {
    method: "PUT",
    headers: buildAuthHeaders(),
    body: JSON.stringify({ combo_product_id: comboProductId, components }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Could not save the combo" }));
    throw new Error(body.error || `API error ${response.status}`);
  }

  const body = (await response.json()) as { components: ComboComponent[] };
  const saved = body.components || [];

  // Through the resource, so a till subscribed via useResource sees an edited
  // meal without a reload.
  const cache = { ...getCachedCombos(storeId) };
  if (saved.length > 0) cache[comboProductId] = saved;
  else delete cache[comboProductId];
  writeResource(combosResource, storeId, cache);

  return saved;
}

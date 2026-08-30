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
import { compareComboComponents, type ComboComponent, type ComboMap } from "./types";

function key(storeId: string): string {
  return `store_combos_${storeId}`;
}

/** One in-flight refresh per store, mirroring the other loaders. */
const inFlight = new Map<string, Promise<ComboMap>>();

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
 * Fetch combos and update the cache.
 *
 * Never clears the cache on failure: an offline till keeps the combos it had.
 * Removing things requires positive evidence — the same rule as the product
 * reconcile and the recipe loader.
 */
export async function refreshCombos(storeId: string): Promise<ComboMap> {
  if (!storeId) return {};

  const existing = inFlight.get(storeId);
  if (existing) return existing;

  const run = (async (): Promise<ComboMap> => {
    try {
      const response = await fetch("/api/combos", { headers: buildAuthHeaders() });
      if (!response.ok) throw new Error(`API error ${response.status}`);

      const body = (await response.json()) as { combos?: ComboMap; truncated?: boolean };
      if (!body.combos || typeof body.combos !== "object") throw new Error("Malformed response");

      // A truncated set would sell a meal missing half its contents and
      // under-deplete stock. Keep the previous copy rather than adopt it.
      if (body.truncated) {
        console.error("[Combos] Server reported a truncated set; keeping the cached copy");
        return getCachedCombos(storeId);
      }

      writeCachedCombos(storeId, body.combos);
      return body.combos;
    } catch (error) {
      console.warn("[Combos] Refresh failed; keeping the cached copy:", error);
      return getCachedCombos(storeId);
    } finally {
      inFlight.delete(storeId);
    }
  })();

  inFlight.set(storeId, run);
  return run;
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

  const cache = getCachedCombos(storeId);
  if (saved.length > 0) cache[comboProductId] = saved;
  else delete cache[comboProductId];
  writeCachedCombos(storeId, cache);

  return saved;
}

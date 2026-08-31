"use client";

// =============================================
// "Do we know what is on the menu yet?" — audit P1-12
// =============================================
// A menu item scanned before the recipes reach this device is sold as a plain
// line: no modifier sheet, `modifiers` NULL so the kitchen never sees a ticket,
// and the menu item's own meaningless stock decremented instead of its
// ingredients. Nothing errors, and the window is widest exactly when a device
// is new, cleared, evicted, or launched with no internet.
//
// The fix is to HOLD the scanned product for at most a moment and then add it
// properly. Two things it is deliberately NOT:
//
//  * **Not a refusal.** Gating the plain-add path on "recipes have loaded" was
//    tried on 2026-08-31 and reverted: without the recipes the till cannot tell
//    a sandwich from a bottle of water, so the guard refused EVERY scan until
//    they arrived. Three ordinary till flows went red. A till that refuses all
//    scans for a second is a worse failure than the mis-sale it prevents.
//  * **Not unbounded.** `MENU_HOLD_MS` caps it. Invariant #10 — a sale is never
//    blocked — applies to a hanging request as much as to a missing register.
//
// The common case costs nothing: `whenResourceSettles` returns immediately when
// the device already knows, which is every scan on a warm till.
// =============================================

import { whenResourceSettles } from "@/lib/data/resource";
import { combosResource } from "@/lib/combos/load";
import { recipesResource } from "@/lib/recipes/load";
import type { ComboMap } from "@/lib/combos/types";
import type { RecipeMap } from "@/lib/recipes/types";

/**
 * How long a scan may wait on the menu data before going through anyway.
 *
 * A healthy `/api/recipes` round trip is ~300 ms and it starts at mount, long
 * before the first scan, so this is reached only when the network is genuinely
 * bad. At that point adding the line plainly is the lesser harm — the cashier
 * can still open the sheet from the cart row, and the customer is served.
 */
export const MENU_HOLD_MS = 1_200;

/**
 * How often the hold re-checks whether the feature flags have resolved.
 *
 * The flags are React state, not a resource, so there is no promise to await —
 * only a value that changes on a later render. 25 ms is below the threshold at
 * which a person perceives a delay at all, and this loop runs only on a device
 * that has never loaded this store's flags.
 */
export const FLAG_POLL_MS = 25;

export interface MenuData {
  recipes: RecipeMap;
  combos: ComboMap;
}

/**
 * Wait — briefly — until this device has an answer for both halves of the menu.
 *
 * Resolves with whatever is known when the wait ends, which on a failed fetch
 * is the empty map. That is the same outcome the bug produced, reached
 * deliberately after trying rather than by mistaking silence for an answer.
 *
 * The two are raced together, not one after the other: they are independent
 * requests and serialising them would double the worst case.
 */
export async function awaitMenuData(
  storeId: string | null | undefined,
  timeoutMs: number = MENU_HOLD_MS,
): Promise<MenuData> {
  const [recipes, combos] = await Promise.all([
    whenResourceSettles(recipesResource, storeId, { timeoutMs }),
    whenResourceSettles(combosResource, storeId, { timeoutMs }),
  ]);
  return { recipes: recipes.data, combos: combos.data };
}

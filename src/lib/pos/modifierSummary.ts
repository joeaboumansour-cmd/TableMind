/**
 * Modifiers → short human labels.
 *
 * One formatter for every surface that shows what was changed about a
 * made-to-order line: the cart row, the receipt, transaction history, and the
 * kitchen ticket. A cook reading "No pickles" and a customer reading it on
 * their receipt must see the same words.
 */

import type { CartLineModifier } from "@/lib/types/cart";

/**
 * Only the CHANGES, never the whole recipe.
 *
 * Listing everything a sandwich contains buries the one line that matters. The
 * cook needs "No pickles", not a recital of the ingredients they already know.
 */
export function describeModifiers(
  modifiers: CartLineModifier[] | null | undefined
): string[] {
  if (!modifiers || modifiers.length === 0) return [];

  const out: string[] = [];
  for (const m of modifiers) {
    if (m.state === "removed") {
      out.push(`No ${m.name}`);
      continue;
    }
    if (m.state === "extra") {
      // A default gives one away free, so "extra" counts from the second.
      const extraUnits = Math.max(1, m.count - (m.is_default_component ? 1 : 0));
      out.push(extraUnits > 1 ? `+${extraUnits} ${m.name}` : `+ ${m.name}`);
    }
  }
  return out;
}

/** True when this line had something changed about it. */
export function hasChanges(
  modifiers: CartLineModifier[] | null | undefined
): boolean {
  return describeModifiers(modifiers).length > 0;
}

/** One-line form for plain-text contexts (a printed receipt line). */
export function summariseModifiers(
  modifiers: CartLineModifier[] | null | undefined
): string {
  return describeModifiers(modifiers).join(", ");
}

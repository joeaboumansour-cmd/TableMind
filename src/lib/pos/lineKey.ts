/**
 * How a cart line is addressed.
 *
 * The cart has always been keyed by `product_id`: every action takes one string
 * and matches it against `item.product_id`, and `addItem` is idempotent so the
 * same product cannot appear twice.
 *
 * Made-to-order breaks that assumption. Two Fries Sandwiches — one with
 * pickles, one without — are two lines of the SAME product, and the cashier
 * must be able to change or remove one without touching the other.
 *
 * The fix is one optional field plus this function. A configured line carries a
 * `line_uid`; everything else does not, and falls back to `product_id`. So:
 *
 *   * every action signature stays `(id: string, …)` — no call site's types
 *     change, no component prop changes;
 *   * for a plain product line the key IS the product id, so a retail store
 *     cannot observe any difference at all;
 *   * a persisted cart written before this existed rehydrates and behaves
 *     exactly as before, with no store migration.
 *
 * That last point is why `line_uid` is optional rather than required. If it is
 * ever made mandatory, THAT is when the persist `version` goes to 2 and
 * `migrate` mints one per persisted line. It is optional precisely so that day
 * never has to be today.
 */

import type { CartItem } from "@/lib/types/cart";

/** The id this line answers to. */
export function lineKey(item: Pick<CartItem, "line_uid" | "product_id">): string {
  return item.line_uid ?? item.product_id;
}

/** A fresh key for a configured line. Never collides with a product UUID. */
export function newLineUid(): string {
  return `line:${crypto.randomUUID()}`;
}

/** Is this line one the cashier configured (i.e. has its own identity)? */
export function isConfiguredLine(
  item: Pick<CartItem, "line_uid" | "line_kind">
): boolean {
  return item.line_kind === "configured" || typeof item.line_uid === "string";
}

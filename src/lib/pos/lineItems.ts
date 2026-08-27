/**
 * Cart line → sale payload.
 *
 * A cart is keyed by `product_id`, but not every line HAS a product: an
 * unknown barcode the cashier prices on the spot is sold once and never
 * enters the catalogue. Those lines carry a synthetic local key so the cart
 * can still address them, and that key must never reach the database —
 * `transaction_items.product_id` is a real FK to `products(id)`.
 *
 * It is nullable, and `POST /api/transactions` already skips the stock
 * decrement when it is absent, so the server needs no special case. What it
 * does need is for the synthetic key to be mapped back to NULL exactly once,
 * on every path a sale can take. That is what this module is for: the server
 * payload and the offline-queue payload are built from the same two functions,
 * so the rule cannot drift between the online and offline paths.
 */

import type { CartItem } from "@/lib/types/cart";

/** Marks a cart key as local-only. Never valid as a UUID, by construction. */
const ONE_OFF_PREFIX = "oneoff:";

/** A fresh local key for a line with no catalogue row behind it. */
export function newOneOffId(): string {
  return ONE_OFF_PREFIX + crypto.randomUUID();
}

/** Is this cart key synthetic (i.e. must not be sent as a product_id)? */
export function isOneOffId(productId: string | null | undefined): boolean {
  return typeof productId === "string" && productId.startsWith(ONE_OFF_PREFIX);
}

/** Is this cart line sold without a catalogue row behind it? */
export function isOneOffLine(item: Pick<CartItem, "product_id" | "line_kind">): boolean {
  return item.line_kind === "one_off" || isOneOffId(item.product_id);
}

/** Line as it is written to `transaction_items` and to `offline_queue`. */
export interface SaleLineItem {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  currency: string;
  unit_price_usd: number;
  total_price_usd: number;
}

/**
 * The line items for a sale. Synthetic keys become NULL here and nowhere else.
 */
export function buildTransactionItems(items: CartItem[]): SaleLineItem[] {
  return items.map((item) => ({
    product_id: isOneOffLine(item) ? null : item.product_id,
    product_name: item.product_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    currency: item.currency,
    unit_price_usd: item.unit_price_usd,
    total_price_usd: item.total_price_usd,
  }));
}

/**
 * Which products to decrement locally. One-off lines have no stock to move,
 * so they are dropped rather than passed along with a key nothing can match.
 */
export function buildStockDecrements(
  items: Array<Pick<CartItem, "product_id" | "line_kind" | "quantity">>
): Array<{ product_id: string; quantity: number }> {
  const out: Array<{ product_id: string; quantity: number }> = [];
  for (const item of items) {
    if (isOneOffLine(item)) continue;
    out.push({ product_id: item.product_id, quantity: item.quantity });
  }
  return out;
}

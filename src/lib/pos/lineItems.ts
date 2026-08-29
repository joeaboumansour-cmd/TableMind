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

import type { CartItem, CartLineModifier } from "@/lib/types/cart";

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
  /**
   * Made-to-order choices, as sold.
   *
   * NULL for an ordinary line; [] for a menu line where nothing was changed.
   * The distinction is what the kitchen board filters on — see migration 032.
   */
  modifiers?: CartLineModifier[] | null;
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
    // `?? null`, never `|| null`: an empty array is a MEANINGFUL value here
    // (a menu line with no changes) and must not be collapsed to null, which
    // means "not a food order at all".
    modifiers: item.modifiers ?? null,
  }));
}

/** A product id and how much of it this sale consumes. */
export interface StockDecrement {
  product_id: string;
  quantity: number;
}

/**
 * What this sale takes out of stock.
 *
 * Three rules, in order:
 *
 *  1. A one-off line has no catalogue row, so nothing to decrement.
 *  2. A line WITH components decrements its COMPONENTS, not itself. A menu
 *     item's own stock_quantity is meaningless — selling a sandwich consumes
 *     bread and pickles, not "one sandwich".
 *  3. A line with no components decrements itself, exactly as it always did.
 *     A bottle of Coke in a snack shop is an ordinary product.
 *
 * Rule 2's condition IS `modifiers.length > 0`; no extra flag is needed.
 *
 * ## Rounding
 *
 * Integerised ONCE, at the whole line: round(qty_per_unit * count * line_qty),
 * never per unit. round(2.5 * 4) = 10, not round(2.5) * 4 = 12. Same principle
 * as the cart's total-only rounding, for the same reason — per-unit rounding
 * compounds and drifts.
 *
 * ## Removed components
 *
 * state === "removed" contributes nothing. That is the whole of "no pickles",
 * and it is why the state lives on the line rather than being re-derived from
 * the recipe at sale time.
 *
 * Results are aggregated by product id: two sandwiches that both use bread
 * produce one decrement of the sum. The RPC is additive so two calls would also
 * be correct, but the server loop is serial awaits and halving them is free.
 */
export function buildStockDecrements(
  items: Array<
    Pick<CartItem, "product_id" | "line_kind" | "quantity"> & {
      modifiers?: CartLineModifier[];
    }
  >
): StockDecrement[] {
  const byProduct = new Map<string, number>();

  const add = (productId: string, quantity: number) => {
    if (quantity <= 0) return;
    byProduct.set(productId, (byProduct.get(productId) || 0) + quantity);
  };

  for (const item of items) {
    if (isOneOffLine(item)) continue;

    const modifiers = item.modifiers;
    if (modifiers && modifiers.length > 0) {
      for (const m of modifiers) {
        if (m.state === "removed") continue;
        add(m.ingredient_product_id, Math.round(m.ingredient_qty * m.count * item.quantity));
      }
      continue;
    }

    add(item.product_id, item.quantity);
  }

  return Array.from(byProduct, ([product_id, quantity]) => ({ product_id, quantity }));
}

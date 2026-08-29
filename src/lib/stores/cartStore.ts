// Cart store for GoldenSquirrel POS
//
// ---- Lanes ----
// A till serves one customer at a time until it doesn't: the person at the
// front forgets their wallet, or wants to fetch one more thing, and the queue
// behind them still has to move. A lane is a parallel cart, so the cashier
// parks that sale and starts another instead of clearing a cart nobody has
// paid for.
//
// `items` deliberately STAYS a top-level field meaning "the active lane's
// items". Checkout, the logout guard and the PWA update listener all read it
// that way, and none of them need to know lanes exist. `lanes` is the record
// of truth and `items` is a mirror of the active entry — kept honest by
// funnelling every mutation through commitItems() below, so there is exactly
// one writer, and by re-deriving the mirror on rehydrate.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logActivity } from '@/lib/activity/logger';
import type { ActivityAction } from '@/lib/activity/types';
import {
  CartStore,
  CartItem,
  Lane,
  LaneSummary,
  OneOffInput,
  CartLinePatch,
  CartLineModifier,
  CartState,
} from '@/lib/types/cart';
import { Product } from '@/lib/types/product';
import { convertLlToUsdForReturn, SELL_RATE, roundToNearest5k } from '@/lib/utils/format';
import { newOneOffId } from '@/lib/pos/lineItems';
import { lineKey, newLineUid } from '@/lib/pos/lineKey';

/** ALT+1..ALT+9 addresses the lanes, so nine is the ceiling. */
export const MAX_LANES = 9;

/**
 * Deterministic, so the server and the first client render agree. Lanes opened
 * afterwards use crypto.randomUUID(); only this one is fixed.
 */
const DEFAULT_LANE_ID = 'lane-1';

function newLane(id: string, items: CartItem[] = []): Lane {
  const now = Date.now();
  return { id, items, created_at: now, last_touched_at: now };
}

function subtotalOf(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.total_price, 0);
}

/**
 * What the customer actually pays: the cart total rounded to the nearest
 * 5,000 LL (the smallest physical bill). This is the ONLY place rounding is
 * applied — never per line item, which compounds and drifts.
 */
function totalOf(items: CartItem[]): number {
  return roundToNearest5k(subtotalOf(items));
}

function unitsOf(items: CartItem[]): number {
  return items.reduce((count, item) => count + item.quantity, 0);
}

/**
 * What `persist` hands back from localStorage. Every field is optional: this
 * is data written by an older build, so nothing about it can be assumed.
 */
interface PersistedCart {
  items?: unknown[];
  store_id?: string | null;
  lanes?: Record<string, { items?: unknown[] } & Partial<Lane>>;
  laneOrder?: string[];
  activeLaneId?: string;
}

/**
 * Total LL charged for add-ons on ONE unit of a line.
 *
 * Only 'extra' components cost anything: an included component is already in
 * the menu price, and a removed one is NOT refunded (crediting for a removal
 * would be a negative-price surface behind a control needing only `pos`).
 *
 * `count` is the total on the line including the default, so a 1x default
 * cheese taken to 3 charges for 2.
 */
function extrasOf(modifiers: CartLineModifier[] | undefined): number {
  if (!modifiers || modifiers.length === 0) return 0;
  let total = 0;
  for (const m of modifiers) {
    if (m.state !== 'extra') continue;
    const extraUnits = Math.max(0, m.count - (m.is_default_component ? 1 : 0));
    total += m.price_delta_ll * extraUnits;
  }
  return total;
}

/** Recompute the derived line totals after quantity or unit price changes. */
function withTotals(item: CartItem, quantity: number): CartItem {
  return {
    ...item,
    quantity,
    total_price: quantity * item.unit_price,
    total_price_usd: quantity * item.unit_price_usd,
    original_total_price: quantity * item.original_unit_price,
    original_total_price_usd: quantity * item.original_unit_price_usd,
    total_discount_amount: quantity * item.unit_price_discount_amount,
  };
}

/**
 * Does ANY lane hold something? The reload guard asks this, not "is the active
 * cart empty" — a service-worker update landing while a parked lane holds a
 * customer's shopping is exactly the interruption the guard exists to prevent.
 */
export function hasAnyLaneItems(state: Pick<CartState, 'lanes' | 'items'>): boolean {
  if (state.items.length > 0) return true;
  const lanes = state.lanes || {};
  for (const id of Object.keys(lanes)) {
    if (lanes[id] && lanes[id].items.length > 0) return true;
  }
  return false;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => {
      /**
       * The single writer. Every action that changes the active lane's
       * contents ends here, so `items` and `lanes[activeLaneId]` cannot drift.
       */
      const commitItems = (
        next: CartItem[],
        event?: {
          action: ActivityAction;
          target?: string;
          details?: Record<string, unknown>;
        }
      ) => {
        set((s) => {
          const lane = s.lanes[s.activeLaneId] || newLane(s.activeLaneId);
          return {
            items: next,
            lanes: {
              ...s.lanes,
              [s.activeLaneId]: { ...lane, items: next, last_touched_at: Date.now() },
            },
          };
        });

        // Logged from the single writer rather than from each action, so a
        // future mutation cannot be added without also being recorded. Fire and
        // forget — logActivity never throws and never returns a promise.
        if (event) {
          logActivity(event.action, {
            target: event.target,
            details: {
              ...event.details,
              lane_id: get().activeLaneId,
              cart_lines: next.length,
            },
          });
        }
      };

      return {
        // ---- State ----
        items: [],
        store_id: null,
        lanes: { [DEFAULT_LANE_ID]: newLane(DEFAULT_LANE_ID) },
        laneOrder: [DEFAULT_LANE_ID],
        activeLaneId: DEFAULT_LANE_ID,

        // ---- Actions ----
        addItem: (product: Product, quantity: number = 1) => {
          const { items } = get();
          // lineKey() is product_id for a plain line, so this is the same
          // check it always was. A configured line's key is a `line:` uuid and
          // can never collide with a product id.
          const existingItem = items.find(item => lineKey(item) === product.id);

          // Idempotent: scanning the same product must NOT increment quantity.
          // Quantity is only ever increased via the manual "+" button (incrementQuantity).
          // Returns true only if the item was actually added (not already present).
          if (existingItem) {
            return false;
          }

          // Normalize prices based on the currency dropdown value from the DB
          let unitPriceUsd: number;
          let unitPriceLl: number;

          if (product.currency === 'USD') {
            // If base price is USD, calculate exact LL by multiplying by the SELL_RATE.
            // NOTE: We do NOT round per-item — rounding happens on the cart total only.
            unitPriceUsd = product.selling_price;
            unitPriceLl = product.selling_price * SELL_RATE;
          } else {
            // If base price is LL (default), calculate USD using the utility function
            unitPriceLl = product.selling_price;
            unitPriceUsd = convertLlToUsdForReturn(product.selling_price);
          }

          // Calculate discount — exact, unrounded. Rounding happens on the cart total.
          const discountPercentage = product.discount_percentage || 0;
          let discountedUnitPriceLl = unitPriceLl;
          let discountedUnitPriceUsd = unitPriceUsd;

          if (discountPercentage > 0) {
            discountedUnitPriceLl = unitPriceLl * (1 - discountPercentage / 100);
            discountedUnitPriceUsd = unitPriceUsd * (1 - discountPercentage / 100);
          }

          const unitPriceDiscountAmount = unitPriceLl - discountedUnitPriceLl;

          // Add new item at the top of the cart
          const newItem: CartItem = {
            product_id: product.id,
            product_name: product.name,
            barcode: product.barcode,
            quantity,
            unit_price: discountedUnitPriceLl,
            total_price: quantity * discountedUnitPriceLl,
            unit_price_usd: discountedUnitPriceUsd,
            total_price_usd: quantity * discountedUnitPriceUsd,
            stock_quantity: product.stock_quantity,
            currency: product.currency || 'LL',
            // Discount fields
            discount_percentage: discountPercentage,
            original_unit_price: unitPriceLl,
            original_total_price: quantity * unitPriceLl,
            original_unit_price_usd: unitPriceUsd,
            original_total_price_usd: quantity * unitPriceUsd,
            unit_price_discount_amount: unitPriceDiscountAmount,
            total_discount_amount: quantity * unitPriceDiscountAmount,
            line_kind: 'product',
            catalog_unit_price: unitPriceLl,
          };
          commitItems([newItem, ...items], {
            action: 'cart.add',
            target: product.name,
            details: {
              product_id: product.id,
              barcode: product.barcode,
              quantity,
              unit_price_ll: discountedUnitPriceLl,
              discount_percentage: discountPercentage,
            },
          });
          return true;
        },

        /**
         * A line for something the catalogue does not have. The price is taken
         * exactly as typed, in LL — LL is the base currency, and rounding
         * belongs to the cart total, not to a line.
         *
         * Returns the synthetic key so the caller can address the line (to
         * highlight or edit it). That key is mapped to NULL before the sale
         * leaves the device; see src/lib/pos/lineItems.ts.
         */
        addOneOffItem: (input: OneOffInput) => {
          const { items } = get();
          const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
          const unitPriceLl = input.unitPriceLl;
          const unitPriceUsd = convertLlToUsdForReturn(unitPriceLl);
          const id = newOneOffId();

          const newItem: CartItem = {
            product_id: id,
            product_name: input.name,
            barcode: input.barcode === undefined ? null : input.barcode,
            quantity,
            unit_price: unitPriceLl,
            total_price: quantity * unitPriceLl,
            unit_price_usd: unitPriceUsd,
            total_price_usd: quantity * unitPriceUsd,
            // No catalogue row means no stock to run out of. A finite number
            // here would let a quantity bump hit a limit that does not exist.
            stock_quantity: Number.MAX_SAFE_INTEGER,
            currency: 'LL',
            // A hand-typed price IS the price: no discount, and the "original"
            // equals it, so the cart cannot claim a saving that never happened.
            discount_percentage: 0,
            original_unit_price: unitPriceLl,
            original_total_price: quantity * unitPriceLl,
            original_unit_price_usd: unitPriceUsd,
            original_total_price_usd: quantity * unitPriceUsd,
            unit_price_discount_amount: 0,
            total_discount_amount: 0,
            line_kind: 'one_off',
          };
          commitItems([newItem, ...items], {
            action: 'cart.add_one_off',
            target: input.name,
            details: {
              one_off_id: id,
              barcode: input.barcode ?? null,
              quantity,
              unit_price_ll: unitPriceLl,
            },
          });
          return id;
        },

        /**
         * A made-to-order line.
         *
         * ALWAYS appends, never dedupes — mirroring addOneOffItem. Two
         * identical sandwiches stay two lines: the kitchen prepares them in
         * parallel, and one can be voided without touching the other. Merging
         * on a "modifier signature" would make remove ambiguous, and +/-
         * already covers "two of the same".
         *
         * Money, per CLAUDE.md §3:
         *  - add-ons are EXACT LL, summed into unit_price. No per-line
         *    rounding; roundToNearest5k stays in getTotal() alone.
         *  - the product discount applies to the BASE only, never to add-ons,
         *    so "50% off sandwich" does not silently halve the extra cheese.
         *  - a USD-priced menu item is converted to LL first and the line
         *    becomes currency 'LL', because a line carrying LL add-ons is no
         *    longer tracking the rate and the field should say so.
         */
        addConfiguredItem: (product: Product, modifiers: CartLineModifier[], quantity = 1) => {
          const { items } = get();
          const qty = quantity > 0 ? quantity : 1;
          const uid = newLineUid();

          const baseLl =
            product.currency === 'USD'
              ? product.selling_price * SELL_RATE
              : product.selling_price;

          const discountPercentage = product.discount_percentage || 0;
          const discountedBase =
            discountPercentage > 0
              ? baseLl * (1 - discountPercentage / 100)
              : baseLl;

          const extras = extrasOf(modifiers);
          const unitPriceLl = discountedBase + extras;
          const originalUnitPriceLl = baseLl + extras;
          const unitPriceUsd = convertLlToUsdForReturn(unitPriceLl);
          const originalUnitPriceUsd = convertLlToUsdForReturn(originalUnitPriceLl);
          const unitDiscount = originalUnitPriceLl - unitPriceLl;

          const newItem: CartItem = {
            product_id: product.id,
            product_name: product.name,
            barcode: product.barcode,
            quantity: qty,
            unit_price: unitPriceLl,
            total_price: qty * unitPriceLl,
            unit_price_usd: unitPriceUsd,
            total_price_usd: qty * unitPriceUsd,
            stock_quantity: product.stock_quantity,
            currency: 'LL',
            discount_percentage: discountPercentage,
            original_unit_price: originalUnitPriceLl,
            original_total_price: qty * originalUnitPriceLl,
            original_unit_price_usd: originalUnitPriceUsd,
            original_total_price_usd: qty * originalUnitPriceUsd,
            unit_price_discount_amount: unitDiscount,
            total_discount_amount: qty * unitDiscount,
            line_kind: 'configured',
            catalog_unit_price: baseLl,
            line_uid: uid,
            modifiers,
          };

          commitItems([newItem, ...items], {
            action: 'cart.configure',
            target: product.name,
            details: {
              product_id: product.id,
              line_uid: uid,
              quantity: qty,
              unit_price_ll: unitPriceLl,
              extras_ll: extras,
              removed: modifiers.filter(m => m.state === 'removed').map(m => m.name),
              added: modifiers.filter(m => m.state === 'extra').map(m => m.name),
            },
          });
          return uid;
        },

        /**
         * Replace a configured line's modifiers and re-price it.
         *
         * The base is DERIVED (`unit_price - extras(current)`) rather than
         * stored. That is what makes the interaction with updateLine correct
         * for free: a cashier who retyped the whole line price typed it
         * INCLUDING the current add-ons, so removing one afterwards drops that
         * delta off the typed price rather than resurrecting the catalogue one.
         */
        updateItemModifiers: (lineId: string, modifiers: CartLineModifier[]) => {
          const { items } = get();
          const before = items.find(item => lineKey(item) === lineId);
          if (!before) return;

          commitItems(
            items.map((item) => {
              if (lineKey(item) !== lineId) return item;

              const currentExtras = extrasOf(item.modifiers || []);
              const nextExtras = extrasOf(modifiers);
              const base = item.unit_price - currentExtras;
              const originalBase = item.original_unit_price - currentExtras;

              const unitPriceLl = base + nextExtras;
              const originalUnitPriceLl = originalBase + nextExtras;
              const unitPriceUsd = convertLlToUsdForReturn(unitPriceLl);
              const originalUnitPriceUsd = convertLlToUsdForReturn(originalUnitPriceLl);
              const unitDiscount = originalUnitPriceLl - unitPriceLl;

              return withTotals(
                {
                  ...item,
                  modifiers,
                  unit_price: unitPriceLl,
                  unit_price_usd: unitPriceUsd,
                  original_unit_price: originalUnitPriceLl,
                  original_unit_price_usd: originalUnitPriceUsd,
                  unit_price_discount_amount: unitDiscount,
                },
                item.quantity
              );
            }),
            {
              action: 'cart.modifiers_changed',
              target: before.product_name,
              details: {
                product_id: before.product_id,
                line_uid: before.line_uid,
                removed: modifiers.filter(m => m.state === 'removed').map(m => m.name),
                added: modifiers.filter(m => m.state === 'extra').map(m => m.name),
                price_from_ll: before.unit_price,
              },
            }
          );
        },

        removeItem: (productId: string) => {
          const { items } = get();
          const removed = items.find(item => lineKey(item) === productId);
          commitItems(items.filter(item => lineKey(item) !== productId), {
            action: 'cart.remove',
            target: removed?.product_name,
            details: {
              product_id: productId,
              quantity: removed?.quantity,
              unit_price_ll: removed?.unit_price,
              line_kind: removed?.line_kind,
            },
          });
        },

        updateQuantity: (productId: string, quantity: number) => {
          const { items } = get();
          if (quantity <= 0) {
            get().removeItem(productId);
            return;
          }

          const before = items.find(item => lineKey(item) === productId);
          commitItems(
            items.map(item =>
              lineKey(item) === productId ? withTotals(item, quantity) : item
            ),
            {
              action: 'cart.quantity',
              target: before?.product_name,
              details: {
                product_id: productId,
                from: before?.quantity,
                to: quantity,
              },
            }
          );
        },

        /**
         * Retype a line's name and/or unit price for this sale.
         *
         * Money rules, per CLAUDE.md §3:
         *  - the LL price is stored EXACTLY as typed; no per-line rounding
         *  - USD is derived with convertLlToUsdForReturn, the same helper
         *    addItem() uses for an LL-priced product
         *  - the discount is cleared and `original_*` is set to the new price.
         *    An overridden price is the price; leaving the old original behind
         *    would make the cart report a discount nobody gave and inflate
         *    getTotalDiscount().
         */
        updateLine: (productId: string, patch: CartLinePatch) => {
          const { items } = get();
          const before = items.find((item) => lineKey(item) === productId);
          commitItems(
            items.map((item) => {
              if (lineKey(item) !== productId) return item;

              let next: CartItem = { ...item };

              if (typeof patch.name === 'string' && patch.name.trim()) {
                const name = patch.name.trim();
                if (name !== item.product_name) {
                  next.product_name = name;
                  next.is_name_overridden = true;
                }
              }

              if (
                typeof patch.unitPriceLl === 'number' &&
                Number.isFinite(patch.unitPriceLl) &&
                patch.unitPriceLl >= 0 &&
                patch.unitPriceLl !== item.unit_price
              ) {
                const unitPriceLl = patch.unitPriceLl;
                const unitPriceUsd = convertLlToUsdForReturn(unitPriceLl);
                next = {
                  ...next,
                  catalog_unit_price:
                    item.catalog_unit_price === undefined
                      ? item.original_unit_price
                      : item.catalog_unit_price,
                  unit_price: unitPriceLl,
                  unit_price_usd: unitPriceUsd,
                  currency: 'LL',
                  discount_percentage: 0,
                  original_unit_price: unitPriceLl,
                  original_unit_price_usd: unitPriceUsd,
                  unit_price_discount_amount: 0,
                  is_price_overridden: true,
                };
              }

              return withTotals(next, next.quantity);
            }),
            {
              // The pricing trail. `from` is what the line cost a moment ago and
              // `to` is what the customer will actually be charged — the pair is
              // the whole point of recording this.
              action: 'cart.line_edit',
              target: before?.product_name,
              details: {
                product_id: productId,
                name_from: before?.product_name,
                name_to: patch.name,
                price_from_ll: before?.unit_price,
                price_to_ll: patch.unitPriceLl,
                catalog_price_ll: before?.catalog_unit_price ?? before?.original_unit_price,
                line_kind: before?.line_kind,
              },
            }
          );
        },

        incrementQuantity: (productId: string) => {
          const { items } = get();
          const item = items.find(i => lineKey(i) === productId);
          if (item) {
            get().updateQuantity(productId, item.quantity + 1);
            return true;
          }
          return false;
        },

        decrementQuantity: (productId: string) => {
          const { items } = get();
          const item = items.find(i => lineKey(i) === productId);
          if (item && item.quantity > 1) {
            get().updateQuantity(productId, item.quantity - 1);
          } else if (item) {
            get().removeItem(productId);
          }
        },

        clearCart: (reason: 'manual' | 'sale_committed' = 'manual') => {
          const { items } = get();
          commitItems([], {
            action: 'cart.clear',
            details: {
              cleared_lines: items.length,
              cleared_units: items.reduce((sum, i) => sum + i.quantity, 0),
              reason,
            },
          });
        },

        setStoreId: (storeId: string) => {
          set({ store_id: storeId });
        },

        // ---- Lanes ----

        canOpenLane: () => get().laneOrder.length < MAX_LANES,

        openLane: () => {
          const s = get();
          if (s.laneOrder.length >= MAX_LANES) return null;
          const id = crypto.randomUUID();
          set({
            lanes: { ...s.lanes, [id]: newLane(id) },
            laneOrder: [...s.laneOrder, id],
            activeLaneId: id,
            items: [],
          });
          logActivity('cart.lane_open', {
            target: id,
            details: { lane_count: s.laneOrder.length + 1 },
          });
          return id;
        },

        /**
         * Closing the last remaining lane empties it rather than removing it —
         * the POS always has somewhere to scan into.
         */
        closeLane: (laneId: string) => {
          const s = get();
          if (!s.lanes[laneId]) return;

          // Closing a lane discards a customer's shopping, so what was in it
          // matters more than the fact it closed.
          const discarded = s.lanes[laneId].items;
          const discardedDetails = {
            discarded_lines: discarded.length,
            discarded_units: discarded.reduce((sum, i) => sum + i.quantity, 0),
          };

          if (s.laneOrder.length <= 1) {
            const cleared = newLane(laneId);
            set({
              lanes: { [laneId]: cleared },
              laneOrder: [laneId],
              activeLaneId: laneId,
              items: [],
            });
            logActivity('cart.lane_close', {
              target: laneId,
              details: { ...discardedDetails, emptied_last_lane: true },
            });
            return;
          }

          const index = s.laneOrder.indexOf(laneId);
          const laneOrder = s.laneOrder.filter((id) => id !== laneId);
          const lanes = { ...s.lanes };
          delete lanes[laneId];

          // Closing the lane you are standing in moves you to its neighbour,
          // preferring the one on the left so the strip does not jump forward.
          let activeLaneId = s.activeLaneId;
          if (activeLaneId === laneId) {
            activeLaneId = laneOrder[Math.max(0, index - 1)] || laneOrder[0];
          }

          set({
            lanes,
            laneOrder,
            activeLaneId,
            items: lanes[activeLaneId] ? lanes[activeLaneId].items : [],
          });
          logActivity('cart.lane_close', {
            target: laneId,
            details: { ...discardedDetails, lane_count: laneOrder.length },
          });
        },

        switchLane: (laneId: string) => {
          const s = get();
          const lane = s.lanes[laneId];
          if (!lane || s.activeLaneId === laneId) return;
          set({ activeLaneId: laneId, items: lane.items });
          logActivity('cart.lane_switch', {
            target: laneId,
            details: { from: s.activeLaneId, lines: lane.items.length },
          });
        },

        switchLaneByPosition: (position: number) => {
          const s = get();
          const laneId = s.laneOrder[position - 1];
          if (laneId) get().switchLane(laneId);
        },

        getLaneSummaries: (): LaneSummary[] => {
          const s = get();
          const now = Date.now();
          return s.laneOrder.map((id, index) => {
            const lane = s.lanes[id];
            const isActive = id === s.activeLaneId;
            // The active lane reads from the mirror, which is what the UI has
            // just been mutating — one render ahead of the lanes record.
            const items = isActive ? s.items : lane ? lane.items : [];
            return {
              id,
              label: `Lane ${index + 1}`,
              position: index + 1,
              itemCount: items.length,
              unitCount: unitsOf(items),
              total: totalOf(items),
              idleMs: Math.max(0, now - (lane ? lane.last_touched_at : now)),
              isActive,
              isEmpty: items.length === 0,
            };
          });
        },

        // ---- Totals (active lane) ----

        getSubtotal: () => subtotalOf(get().items),

        getSubtotalUsd: () => {
          const { items } = get();
          return items.reduce((sum, item) => sum + item.total_price_usd, 0);
        },

        getTotal: () => totalOf(get().items),

        // The USD equivalent of the amount actually CHARGED, which means it has
        // to be derived from the rounded LL total.
        //
        // This used to return getSubtotalUsd() — the sum of the per-line USD
        // figures — so the LL side rounded at the total and the USD side never
        // followed it. The two headline numbers on the till contradicted each
        // other (980,000 LL beside $11.02, when 980,000 LL is $11.01), the same
        // figure was persisted as usd_total_amount on every sale, and USD
        // accumulated exactly the per-line drift the LL side is built to avoid.
        //
        // RETURN_RATE, not SELL_RATE: this answers "how many dollars instead?",
        // and checkout values incoming USD tender at RETURN_RATE, so that is
        // what the customer would actually have to hand over.
        getTotalUsd: () => {
          return convertLlToUsdForReturn(get().getTotal());
        },

        // The difference between the rounded total (charged) and the exact subtotal.
        // Positive = customer pays a bit more, negative = customer pays a bit less.
        getRoundingAdjustment: () => {
          return get().getTotal() - get().getSubtotal();
        },

        getTotalDiscount: () => {
          const { items } = get();
          return items.reduce((sum, item) => sum + item.total_discount_amount, 0);
        },

        getTotalDiscountUsd: () => {
          const { items } = get();
          return items.reduce((sum, item) => sum + (item.original_total_price_usd - item.total_price_usd), 0);
        },

        getTotalOriginal: () => {
          const { items } = get();
          return items.reduce((sum, item) => sum + item.original_total_price, 0);
        },

        getTotalOriginalUsd: () => {
          const { items } = get();
          return items.reduce((sum, item) => sum + item.original_total_price_usd, 0);
        },

        getItemCount: () => unitsOf(get().items),

        isEmpty: () => get().items.length === 0,
      };
    },
    {
      name: 'goldensquirrel-cart',
      // v1 introduced lanes. The item-level backfill below predates versioning
      // and must keep running for carts persisted before it existed.
      version: 1,
      partialize: (state) => ({
        items: state.items,
        store_id: state.store_id,
        lanes: state.lanes,
        laneOrder: state.laneOrder,
        activeLaneId: state.activeLaneId,
      }),
      migrate: (persistedState: unknown) => {
        const cart = persistedState as PersistedCart | null | undefined;
        if (!cart) return cart;

        const backfill = (raw: unknown) => {
          const item = raw as Record<string, unknown>;
          return {
          ...item,
          stock_quantity: item.stock_quantity ?? 9999,
          // Add discount fields for backward compatibility with existing cart data
          discount_percentage: item.discount_percentage ?? 0,
          original_unit_price: item.original_unit_price ?? item.unit_price,
          original_total_price: item.original_total_price ?? item.total_price,
          original_unit_price_usd: item.original_unit_price_usd ?? item.unit_price_usd,
          original_total_price_usd: item.original_total_price_usd ?? item.total_price_usd,
          unit_price_discount_amount: item.unit_price_discount_amount ?? 0,
          total_discount_amount: item.total_discount_amount ?? 0,
          } as CartItem;
        };

        if (Array.isArray(cart.items)) {
          cart.items = cart.items.map(backfill);
        }
        if (cart.lanes && typeof cart.lanes === 'object') {
          for (const id of Object.keys(cart.lanes)) {
            const lane = cart.lanes[id];
            if (lane && Array.isArray(lane.items)) lane.items = lane.items.map(backfill);
          }
        }

        // Pre-lanes cart: wrap whatever was in it as Lane 1 so an open sale
        // survives the upgrade.
        if (!cart.lanes || !cart.activeLaneId) {
          const items = (Array.isArray(cart.items) ? cart.items : []) as CartItem[];
          cart.lanes = { [DEFAULT_LANE_ID]: newLane(DEFAULT_LANE_ID, items) };
          cart.laneOrder = [DEFAULT_LANE_ID];
          cart.activeLaneId = DEFAULT_LANE_ID;
        }

        return cart as unknown as CartStore;
      },
      // `lanes` is the record of truth on load. Re-deriving the mirror here
      // means a torn write (lanes saved, items not) cannot resurrect a stale
      // cart, and a missing or renamed active lane cannot strand the POS.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.lanes || Object.keys(state.lanes).length === 0) {
          state.lanes = { [DEFAULT_LANE_ID]: newLane(DEFAULT_LANE_ID, state.items || []) };
          state.laneOrder = [DEFAULT_LANE_ID];
          state.activeLaneId = DEFAULT_LANE_ID;
        }
        const known = Object.keys(state.lanes);
        if (!Array.isArray(state.laneOrder) || state.laneOrder.length === 0) {
          state.laneOrder = known;
        } else {
          // Drop ids with no lane behind them, and adopt any lane the order
          // forgot, so the strip always matches the record.
          state.laneOrder = state.laneOrder.filter((id) => !!state.lanes[id]);
          for (const id of known) {
            if (state.laneOrder.indexOf(id) === -1) state.laneOrder.push(id);
          }
        }
        if (!state.activeLaneId || !state.lanes[state.activeLaneId]) {
          state.activeLaneId = state.laneOrder[0];
        }
        state.items = state.lanes[state.activeLaneId]
          ? state.lanes[state.activeLaneId].items
          : [];
      },
    }
  )
);

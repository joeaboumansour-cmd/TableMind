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
import {
  CartStore,
  CartItem,
  Lane,
  LaneSummary,
  OneOffInput,
  CartLinePatch,
  CartState,
} from '@/lib/types/cart';
import { Product } from '@/lib/types/product';
import { convertLlToUsdForReturn, SELL_RATE, roundToNearest5k } from '@/lib/utils/format';
import { newOneOffId } from '@/lib/pos/lineItems';

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
      const commitItems = (next: CartItem[]) =>
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
          const existingItem = items.find(item => item.product_id === product.id);

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
          commitItems([newItem, ...items]);
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
          commitItems([newItem, ...items]);
          return id;
        },

        removeItem: (productId: string) => {
          const { items } = get();
          commitItems(items.filter(item => item.product_id !== productId));
        },

        updateQuantity: (productId: string, quantity: number) => {
          const { items } = get();
          if (quantity <= 0) {
            get().removeItem(productId);
            return;
          }

          commitItems(
            items.map(item =>
              item.product_id === productId ? withTotals(item, quantity) : item
            )
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
          commitItems(
            items.map((item) => {
              if (item.product_id !== productId) return item;

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
            })
          );
        },

        incrementQuantity: (productId: string) => {
          const { items } = get();
          const item = items.find(i => i.product_id === productId);
          if (item) {
            get().updateQuantity(productId, item.quantity + 1);
            return true;
          }
          return false;
        },

        decrementQuantity: (productId: string) => {
          const { items } = get();
          const item = items.find(i => i.product_id === productId);
          if (item && item.quantity > 1) {
            get().updateQuantity(productId, item.quantity - 1);
          } else if (item) {
            get().removeItem(productId);
          }
        },

        clearCart: () => {
          commitItems([]);
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
          return id;
        },

        /**
         * Closing the last remaining lane empties it rather than removing it —
         * the POS always has somewhere to scan into.
         */
        closeLane: (laneId: string) => {
          const s = get();
          if (!s.lanes[laneId]) return;

          if (s.laneOrder.length <= 1) {
            const cleared = newLane(laneId);
            set({
              lanes: { [laneId]: cleared },
              laneOrder: [laneId],
              activeLaneId: laneId,
              items: [],
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
        },

        switchLane: (laneId: string) => {
          const s = get();
          const lane = s.lanes[laneId];
          if (!lane || s.activeLaneId === laneId) return;
          set({ activeLaneId: laneId, items: lane.items });
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

        getTotalUsd: () => {
          return get().getSubtotalUsd();
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

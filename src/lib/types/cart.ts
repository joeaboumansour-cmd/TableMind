// Cart types for GoldenSquirrel Mobile POS

import { Product } from './product';

/**
 * How a cart line came to exist.
 *
 * 'product'  — a real catalogue row; `product_id` is its UUID.
 * 'one_off'  — sold once and never entered the catalogue (an unknown barcode
 *              the cashier priced on the spot, or a request still awaiting
 *              approval). `product_id` is a synthetic local key and is mapped
 *              to NULL before the sale is sent anywhere — see
 *              `src/lib/pos/lineItems.ts`. transaction_items.product_id is
 *              nullable, and the transactions API already skips the stock
 *              decrement when it is absent.
 */
export type CartLineKind = 'product' | 'one_off' | 'configured';

/**
 * One ingredient choice on a made-to-order line.
 *
 * `name` and `price_delta_ll` are DENORMALISED onto the line on purpose: the
 * recipe can be edited while a sale is in progress, and the cart must not
 * re-price itself under the cashier. Same principle that makes
 * transaction_items carry its own product_name and unit_price.
 *
 * A configured line stores EVERY component, including untouched ones as
 * 'included'. That is what lets the sale-time expansion in lineItems.ts need
 * no external lookup, and lets a kitchen ticket render from the line alone.
 */
export interface CartLineModifier {
  /**
   * Which choice this is.
   *
   * Normally `recipe_components.id`. For an ingredient added that is NOT in
   * the product's recipe at all — hummus on a taouk sandwich — there is no
   * recipe row, so this is a synthetic `adhoc:<uuid>` key. Same convention as
   * the cart's `oneoff:` line keys: local-only, never a real id, and never
   * sent anywhere that expects one.
   */
  component_id: string;
  /** The ingredient. Needed for stock, and to survive a recipe edit. */
  ingredient_product_id: string;
  /**
   * True when this ingredient is not part of the product's recipe. Its price
   * came from the INGREDIENT PRODUCT'S OWN selling_price rather than from a
   * recipe row's price_delta_ll.
   */
  is_adhoc?: boolean;
  /** Denormalised: the name AS SOLD. */
  name: string;
  /**
   * 'included' — came with it, at ingredient_qty, no charge
   * 'removed'  — "no pickles": no stock deducted, and NO refund
   * 'extra'    — added: charged price_delta_ll and deducted, per extra unit
   */
  state: 'included' | 'removed' | 'extra';
  /**
   * Units of the ingredient consumed per ONE unit of the menu item, for ONE
   * count of this component. Total deducted is
   * `ingredient_qty * count * line_quantity`.
   */
  ingredient_qty: number;
  /** Charged per EXTRA count, LL, exact. */
  price_delta_ll: number;
  /**
   * How many of this component are on the line. 0 when removed, 1 for a plain
   * default, 2+ when the cashier added more.
   */
  count: number;
  /**
   * Did the recipe include this by default? Denormalised alongside the rest,
   * because it decides how many counts are FREE: a default gives one away, an
   * add-on charges from the first. Re-deriving it from the recipe at sale time
   * would re-price the line if the recipe changed mid-sale.
   */
  is_default_component: boolean;
}

export interface CartItem {
  product_id: string;
  product_name: string;
  barcode: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_price_usd: number;
  total_price_usd: number;
  stock_quantity: number;
  currency: 'LL' | 'USD';
  // Discount fields
  discount_percentage: number;
  original_unit_price: number;
  original_total_price: number;
  original_unit_price_usd: number;
  original_total_price_usd: number;
  unit_price_discount_amount: number;
  total_discount_amount: number;
  // ---- Pro UI additions (all optional: lines persisted before these existed
  //      rehydrate without them and must keep behaving as plain products) ----
  line_kind?: CartLineKind;
  /** Price the catalogue had when the line was added, in LL, before discount.
   *  Kept so an edited row can show what it used to cost. */
  catalog_unit_price?: number;
  /** The cashier retyped the price on this line. */
  is_price_overridden?: boolean;
  /** The cashier retyped the name on this line. */
  is_name_overridden?: boolean;
  /**
   * Present ONLY on a configured (made-to-order) line. Absent means the line's
   * identity is its product_id, exactly as it always was — see lineKey().
   */
  line_uid?: string;
  /** The ingredient choices on a configured line. */
  modifiers?: CartLineModifier[];
  /**
   * Free-text instruction for this line — "cut in half", "extra spicy".
   * Things no ingredient list can express. Reaches the kitchen and the receipt.
   */
  note?: string;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  total_amount: number;
  item_count: number;
}

/**
 * One parallel sale in progress.
 *
 * A cashier serving a customer who has forgotten their wallet parks the lane
 * and opens another rather than clearing the cart, so nothing is lost.
 */
export interface Lane {
  id: string;
  items: CartItem[];
  created_at: number;
  /** Last time anything in this lane changed. Drives the WAITING timer. */
  last_touched_at: number;
}

/** Render-ready view of a lane for the tab strip. */
export interface LaneSummary {
  id: string;
  /** Position-derived: "Lane 1", "Lane 2"… Matches the ALT+n shortcut. */
  label: string;
  /** 1-based position, i.e. the digit in ALT+n. */
  position: number;
  /** Distinct lines. */
  itemCount: number;
  /** Sum of quantities. */
  unitCount: number;
  /** Rounded LL total — the same figure checkout will charge. */
  total: number;
  /** Milliseconds since the lane was last touched. */
  idleMs: number;
  isActive: boolean;
  isEmpty: boolean;
}

/** Everything needed to add a line for something not in the catalogue. */
export interface OneOffInput {
  name: string;
  /** Unit price in LL. Exact — rounding happens on the cart total only. */
  unitPriceLl: number;
  quantity?: number;
  barcode?: string | null;
}

/** Fields of a cart line the cashier may retype. */
export interface CartLinePatch {
  name?: string;
  /** Unit price in LL. Exact. */
  unitPriceLl?: number;
}

export interface CartState {
  /** The ACTIVE lane's items. Mirrored from `lanes[activeLaneId]`. */
  items: CartItem[];
  store_id: string | null;
  lanes: Record<string, Lane>;
  laneOrder: string[];
  activeLaneId: string;
}

export interface CartActions {
  addItem: (product: Product, quantity?: number) => boolean;
  addOneOffItem: (input: OneOffInput) => string;
  /**
   * Add a made-to-order line. ALWAYS appends, never dedupes: two identical
   * sandwiches stay two lines so the kitchen can prepare them in parallel and
   * one can be voided independently. Returns the new line's key.
   */
  addConfiguredItem: (
    product: Product,
    modifiers: CartLineModifier[],
    quantity?: number,
    note?: string
  ) => string;
  /**
   * Replace the modifiers and note on a line, and re-price it.
   *
   * Works on ANY line, not only one that was configured on the way in: in a
   * snack shop every sellable product is customisable, so a plain line that
   * gains a modifier or a note is converted in place and given a line_uid.
   */
  updateItemModifiers: (
    lineId: string,
    modifiers: CartLineModifier[],
    note?: string
  ) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateLine: (productId: string, patch: CartLinePatch) => void;
  incrementQuantity: (productId: string) => boolean;
  decrementQuantity: (productId: string) => void;
  /**
   * Empty the active lane.
   *
   * `reason` only colours the activity log: "manual" is a cashier pressing
   * Clear, "sale_committed" is checkout emptying the lane once the sale is
   * durable. They must stay distinguishable in the trail — an automatic clear
   * after every sale would otherwise look like cashiers constantly wiping carts.
   */
  clearCart: (reason?: "manual" | "sale_committed") => void;
  setStoreId: (storeId: string) => void;
  // ---- Lanes ----
  openLane: () => string | null;
  closeLane: (laneId: string) => void;
  switchLane: (laneId: string) => void;
  /** 1-based, i.e. the digit pressed with ALT. No-op if out of range. */
  switchLaneByPosition: (position: number) => void;
  getLaneSummaries: () => LaneSummary[];
  canOpenLane: () => boolean;
  // ---- Totals (active lane) ----
  getSubtotal: () => number;
  getSubtotalUsd: () => number;
  getTotal: () => number;
  getTotalUsd: () => number;
  getRoundingAdjustment: () => number;
  getTotalDiscount: () => number;
  getTotalDiscountUsd: () => number;
  getTotalOriginal: () => number;
  getTotalOriginalUsd: () => number;
  getItemCount: () => number;
  isEmpty: () => boolean;
}

export type CartStore = CartState & CartActions;

export interface AddToCartOptions {
  quantity?: number;
  playSound?: boolean;
}

export interface CartSummary {
  subtotal: number;
  total_amount: number;
  item_count: number;
  items: CartItem[];
}

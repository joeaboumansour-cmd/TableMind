// =============================================
// Characterization: src/lib/stores/cartStore.ts
//
// Carries invariants #2 (rounding at the total only), #5 (updateLine clears
// the discount), and #18 (lineKey addresses a line). Also the lane behaviour
// the service-worker reload guard depends on.
//
// Each test resets the store, because zustand state is module-level and a
// leaked cart between tests is exactly the flake the plan says to have zero
// tolerance for.
// =============================================

import { describe, it, expect, beforeEach } from "vitest";
import { useCartStore, hasAnyLaneItems, MAX_LANES } from "@/lib/stores/cartStore";
import { lineKey } from "@/lib/pos/lineKey";
import { roundToNearest5k, convertLlToUsdForReturn } from "@/lib/utils/format";
import type { Product } from "@/lib/types/product";
import type { CartLineModifier } from "@/lib/types/cart";

const store = () => useCartStore.getState();

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    store_id: "s1",
    name: "Test Product",
    barcode: "B1",
    cost_price: 10_000,
    selling_price: 30_000,
    currency: "LL",
    stock_quantity: 100,
    discount_percentage: 0,
    kind: "sellable",
    ...over,
  } as Product);

beforeEach(() => {
  // Reset to a single empty lane before every test.
  store().clearCart();
  for (const id of [...store().laneOrder]) {
    if (id !== store().activeLaneId) store().closeLane(id);
  }
  store().clearCart();
  store().setStoreId("s1");
});

describe("addItem", () => {
  it("adds a line and derives its totals", () => {
    store().addItem(product(), 2);
    const [item] = store().items;
    expect(item.product_name).toBe("Test Product");
    expect(item.quantity).toBe(2);
    expect(item.total_price).toBe(item.unit_price * 2);
  });

  // Idempotent by REFUSING, not by accumulating. Scanning the same product
  // twice must not silently double a customer's quantity — going up is only
  // ever the manual "+" (incrementQuantity). The boolean return is how the
  // till knows to play an error sound rather than a success one.
  it("REFUSES a repeat of the same product — quantity does not change", () => {
    expect(store().addItem(product(), 1)).toBe(true);
    expect(store().addItem(product(), 2)).toBe(false);
    expect(store().items).toHaveLength(1);
    expect(store().items[0].quantity).toBe(1);
  });

  it("keeps different products as separate lines", () => {
    store().addItem(product({ id: "p1" }));
    store().addItem(product({ id: "p2", name: "Other" }));
    expect(store().items).toHaveLength(2);
  });

  // Newest at the top, so the line a cashier just scanned is the one they see.
  it("PREPENDS — the most recent line is items[0]", () => {
    store().addItem(product({ id: "a", name: "A" }));
    store().addItem(product({ id: "b", name: "B" }));
    expect(store().items.map((i) => i.product_name)).toEqual(["B", "A"]);
  });
});

describe("getTotal — invariant #2: rounding at the TOTAL only", () => {
  it("rounds the summed subtotal, never the individual lines", () => {
    // Two lines that are each NOT multiples of 5,000. Rounding per line would
    // give a different answer from rounding the sum, which is the whole point.
    // Both at 12,300: subtotal 24,600 -> 25,000, but per-line each rounds to
    // 10,000 for 20,000. A 5,000 LL divergence on two items.
    store().addItem(product({ id: "a", selling_price: 12_300 }), 1);
    store().addItem(product({ id: "b", selling_price: 12_300 }), 1);

    const subtotal = store().getSubtotal();
    expect(store().getTotal()).toBe(roundToNearest5k(subtotal));

    const perLineRounded = store().items.reduce((s, i) => s + roundToNearest5k(i.total_price), 0);
    expect(store().getTotal()).not.toBe(perLineRounded);
  });

  it("line totals themselves are left un-rounded", () => {
    store().addItem(product({ selling_price: 12_300 }), 1);
    expect(store().items[0].total_price % 5000).not.toBe(0);
  });

  it("an empty cart totals zero", () => {
    expect(store().getTotal()).toBe(0);
    expect(store().getSubtotal()).toBe(0);
  });

  it("getRoundingAdjustment is the gap the rounding created", () => {
    store().addItem(product({ selling_price: 12_300 }), 1);
    expect(store().getRoundingAdjustment()).toBe(store().getTotal() - store().getSubtotal());
  });
});

describe("getTotalUsd", () => {
  // Derived from the ROUNDED LL total at RETURN_RATE — not the sum of per-line
  // USD, which let the two headline figures on the till contradict each other.
  it("is the rounded LL total valued at RETURN_RATE", () => {
    store().addItem(product({ selling_price: 12_300 }), 3);
    expect(store().getTotalUsd()).toBe(convertLlToUsdForReturn(store().getTotal()));
  });

  it("follows the LL rounding rather than the per-line USD sum", () => {
    store().addItem(product({ id: "a", selling_price: 12_300 }));
    store().addItem(product({ id: "b", selling_price: 8_400 }));
    expect(store().getTotalUsd()).not.toBe(store().getSubtotalUsd());
  });
});

describe("updateLine — invariant #5: an overridden price IS the price", () => {
  it("retypes the unit price and re-derives the line total", () => {
    store().addItem(product({ selling_price: 30_000 }), 2);
    const key = lineKey(store().items[0]);
    store().updateLine(key, { unitPriceLl: 45_000 });

    const [item] = store().items;
    expect(item.unit_price).toBe(45_000);
    expect(item.total_price).toBe(90_000);
  });

  it("resets original_unit_price to the NEW price, so no phantom discount is reported", () => {
    store().addItem(product({ selling_price: 30_000, discount_percentage: 20 }), 1);
    const key = lineKey(store().items[0]);
    store().updateLine(key, { unitPriceLl: 45_000 });

    const [item] = store().items;
    expect(item.original_unit_price).toBe(45_000);
    expect(store().getTotalDiscount()).toBe(0);
  });

  it("renames a line without touching its price", () => {
    store().addItem(product({ selling_price: 30_000 }));
    const key = lineKey(store().items[0]);
    store().updateLine(key, { name: "Renamed" });
    expect(store().items[0].product_name).toBe("Renamed");
    expect(store().items[0].unit_price).toBe(30_000);
  });
});

describe("quantity", () => {
  it("updateQuantity re-derives the total", () => {
    store().addItem(product({ selling_price: 30_000 }), 1);
    const key = lineKey(store().items[0]);
    store().updateQuantity(key, 4);
    expect(store().items[0].total_price).toBe(store().items[0].unit_price * 4);
  });

  it("decrementing to zero removes the line", () => {
    store().addItem(product(), 1);
    const key = lineKey(store().items[0]);
    store().decrementQuantity(key);
    expect(store().items).toHaveLength(0);
  });

  it("removeItem removes only the addressed line", () => {
    store().addItem(product({ id: "a", name: "A" }));
    store().addItem(product({ id: "b", name: "B" }));
    // Lines are prepended, so items[0] is "B" — remove it and "A" remains.
    store().removeItem(lineKey(store().items[0]));
    expect(store().items).toHaveLength(1);
    expect(store().items[0].product_name).toBe("A");
  });
});

describe("one-off lines", () => {
  it("adds a line with a synthetic key and the exact price given", () => {
    const key = store().addOneOffItem({ name: "Unknown thing", unitPriceLl: 12_300 });
    const item = store().items.find((i) => lineKey(i) === key)!;
    expect(item.product_id.startsWith("oneoff:")).toBe(true);
    expect(item.unit_price).toBe(12_300); // exact — rounding is the total's job
  });

  it("two one-off lines are independent, even with the same name", () => {
    const a = store().addOneOffItem({ name: "Same", unitPriceLl: 10_000 });
    const b = store().addOneOffItem({ name: "Same", unitPriceLl: 10_000 });
    expect(a).not.toBe(b);
    expect(store().items).toHaveLength(2);
  });
});

describe("configured lines — invariant #18", () => {
  const mods: CartLineModifier[] = [
    {
      component_id: "cmp-1",
      ingredient_product_id: "ing1",
      name: "Pickles",
      state: "included",
      ingredient_qty: 20,
      price_delta_ll: 0,
      count: 1,
      is_default_component: true,
    },
  ];

  it("ALWAYS appends, never dedupes — two sandwiches stay two lines", () => {
    store().addConfiguredItem(product({ id: "menu" }), mods, 1);
    store().addConfiguredItem(product({ id: "menu" }), mods, 1);
    expect(store().items).toHaveLength(2);
  });

  it("editing one configured line does not touch its twin", () => {
    const a = store().addConfiguredItem(product({ id: "menu" }), mods, 1);
    store().addConfiguredItem(product({ id: "menu" }), mods, 1);
    store().updateLine(a, { unitPriceLl: 99_000 });

    const edited = store().items.find((i) => lineKey(i) === a)!;
    const other = store().items.find((i) => lineKey(i) !== a)!;
    expect(edited.unit_price).toBe(99_000);
    expect(other.unit_price).not.toBe(99_000);
  });

  it("a configured line gets its own key, distinct from the product id", () => {
    const key = store().addConfiguredItem(product({ id: "menu" }), mods, 1);
    expect(key).not.toBe("menu");
    expect(key.startsWith("line:")).toBe(true);
  });
});

describe("lanes", () => {
  it("starts with one lane", () => {
    expect(store().laneOrder).toHaveLength(1);
  });

  it("opens lanes up to MAX_LANES and then refuses", () => {
    while (store().canOpenLane()) store().openLane();
    expect(store().laneOrder).toHaveLength(MAX_LANES);
    expect(store().openLane()).toBeNull();
  });

  it("switching lanes swaps `items` to that lane's contents", () => {
    store().addItem(product({ id: "a", name: "In lane 1" }));
    const first = store().activeLaneId;

    const second = store().openLane()!;
    store().switchLane(second);
    expect(store().items).toHaveLength(0); // fresh lane

    store().addItem(product({ id: "b", name: "In lane 2" }));
    expect(store().items[0].product_name).toBe("In lane 2");

    store().switchLane(first);
    expect(store().items[0].product_name).toBe("In lane 1");
  });

  // What the service-worker reload guard asks. `items.length` alone is wrong:
  // a PARKED lane holds a customer's shopping too.
  it("hasAnyLaneItems sees a PARKED lane, not just the active one", () => {
    store().addItem(product());
    const parked = store().activeLaneId;
    const fresh = store().openLane()!;
    store().switchLane(fresh);

    expect(store().items).toHaveLength(0);
    expect(hasAnyLaneItems(store())).toBe(true);
    expect(store().lanes[parked].items).toHaveLength(1);
  });

  it("is false only when every lane is empty", () => {
    expect(hasAnyLaneItems(store())).toBe(false);
    store().addItem(product());
    expect(hasAnyLaneItems(store())).toBe(true);
    store().clearCart();
    expect(hasAnyLaneItems(store())).toBe(false);
  });

  it("clearCart empties only the ACTIVE lane", () => {
    store().addItem(product({ id: "a" }));
    const parked = store().activeLaneId;
    const fresh = store().openLane()!;
    store().switchLane(fresh);
    store().addItem(product({ id: "b" }));
    store().clearCart();

    expect(store().items).toHaveLength(0);
    expect(store().lanes[parked].items).toHaveLength(1);
  });
});

describe("items mirrors the active lane", () => {
  it("`items` and `lanes[activeLaneId].items` never drift", () => {
    store().addItem(product({ id: "a" }));
    store().addItem(product({ id: "b" }));
    store().updateQuantity(lineKey(store().items[0]), 5);
    expect(store().items).toEqual(store().lanes[store().activeLaneId].items);
  });
});

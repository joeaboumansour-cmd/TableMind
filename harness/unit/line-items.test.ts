// =============================================
// Characterization: src/lib/pos/lineItems.ts
//
// The cart → sale payload boundary, and the most money-critical pure logic in
// the app. Carries invariants #9 (stock decrements) and #17 (modifiers
// `?? null`).
//
// Both the server payload and the offline-queue payload are built from these
// two functions, which is what stops the online and offline paths disagreeing.
// A test here is therefore a test of both.
// =============================================

import { describe, it, expect } from "vitest";
import {
  buildTransactionItems,
  buildStockDecrements,
  isOneOffId,
  isOneOffLine,
  newOneOffId,
} from "@/lib/pos/lineItems";
import type { CartItem, CartLineModifier } from "@/lib/types/cart";

const line = (over: Partial<CartItem> = {}): CartItem =>
  ({
    product_id: "prod-1",
    product_name: "Thing",
    quantity: 1,
    unit_price: 50_000,
    total_price: 50_000,
    currency: "LL",
    unit_price_usd: 0.55,
    total_price_usd: 0.55,
    ...over,
  } as CartItem);

// A complete CartLineModifier. `state` is 'included' | 'removed' | 'extra' —
// there is no "kept". Only 'removed' is special-cased by buildStockDecrements,
// so an invalid state would silently behave like 'included' and make a test
// look like it proved something it did not.
const mod = (over: Partial<CartLineModifier> = {}): CartLineModifier => ({
  component_id: "cmp-1",
  ingredient_product_id: "ing-1",
  name: "Pickles",
  state: "included",
  ingredient_qty: 20,
  price_delta_ll: 0,
  count: 1,
  is_default_component: true,
  ...over,
});

describe("one-off identity", () => {
  it("recognises the synthetic prefix", () => {
    expect(isOneOffId("oneoff:abc")).toBe(true);
    expect(isOneOffId("prod-1")).toBe(false);
    expect(isOneOffId(null)).toBe(false);
    expect(isOneOffId(undefined)).toBe(false);
  });

  it("newOneOffId produces a key that is never a bare UUID", () => {
    const id = newOneOffId();
    expect(isOneOffId(id)).toBe(true);
    expect(id.startsWith("oneoff:")).toBe(true);
  });

  it("a line is one-off by EITHER its kind or its key", () => {
    expect(isOneOffLine({ product_id: "oneoff:x", line_kind: undefined })).toBe(true);
    expect(isOneOffLine({ product_id: "prod-1", line_kind: "one_off" })).toBe(true);
    expect(isOneOffLine({ product_id: "prod-1", line_kind: undefined })).toBe(false);
  });
});

describe("buildTransactionItems", () => {
  it("passes an ordinary line through with its product id", () => {
    const [out] = buildTransactionItems([line()]);
    expect(out.product_id).toBe("prod-1");
    expect(out.total_price).toBe(50_000);
  });

  // The synthetic key must never reach the database: product_id is a real FK.
  it("maps a one-off line's synthetic key to NULL", () => {
    const [out] = buildTransactionItems([line({ product_id: "oneoff:abc", line_kind: "one_off" })]);
    expect(out.product_id).toBeNull();
    expect(out.product_name).toBe("Thing");
  });

  // Invariant #17. `[]` and null mean different things to the kitchen board,
  // which filters tickets on `modifiers IS NOT NULL`.
  it("preserves an EMPTY modifier array — it is not the same as null", () => {
    const [out] = buildTransactionItems([line({ modifiers: [] })]);
    expect(out.modifiers).toEqual([]);
    expect(out.modifiers).not.toBeNull();
  });

  it("uses null for a line with no modifiers at all", () => {
    const [out] = buildTransactionItems([line()]);
    expect(out.modifiers).toBeNull();
  });

  it("trims a note, and an empty note becomes null not an empty string", () => {
    expect(buildTransactionItems([line({ note: "  extra hot  " })])[0].note).toBe("extra hot");
    expect(buildTransactionItems([line({ note: "   " })])[0].note).toBeNull();
    expect(buildTransactionItems([line()])[0].note).toBeNull();
  });

  it("preserves combo_children, defaulting to null", () => {
    expect(buildTransactionItems([line()])[0].combo_children).toBeNull();
    const kids = [{ product_id: "p", product_name: "n", quantity: 1 }] as never;
    expect(buildTransactionItems([line({ combo_children: kids })])[0].combo_children).toEqual(kids);
  });

  it("maps every line, preserving order", () => {
    const out = buildTransactionItems([line({ product_name: "A" }), line({ product_name: "B" })]);
    expect(out.map((o) => o.product_name)).toEqual(["A", "B"]);
  });
});

describe("buildStockDecrements", () => {
  it("decrements an ordinary line by its own quantity", () => {
    expect(buildStockDecrements([line({ quantity: 3 })])).toEqual([{ product_id: "prod-1", quantity: 3 }]);
  });

  it("decrements NOTHING for a one-off line — there is no catalogue row", () => {
    expect(buildStockDecrements([line({ product_id: "oneoff:x", line_kind: "one_off", quantity: 2 })])).toEqual([]);
  });

  // Rule 2. Selling a sandwich consumes bread and pickles, not "one sandwich".
  it("decrements COMPONENTS, not the menu item, when modifiers are present", () => {
    const out = buildStockDecrements([
      line({
        product_id: "menu-1",
        quantity: 1,
        modifiers: [mod({ ingredient_product_id: "bread", ingredient_qty: 1 }), mod({ ingredient_product_id: "pickles", ingredient_qty: 20 })],
      }),
    ]);
    expect(out).toEqual([
      { product_id: "bread", quantity: 1 },
      { product_id: "pickles", quantity: 20 },
    ]);
    expect(out.find((d) => d.product_id === "menu-1")).toBeUndefined();
  });

  it("a REMOVED modifier contributes nothing — that is 'no pickles'", () => {
    const out = buildStockDecrements([
      line({ product_id: "menu-1", modifiers: [mod({ ingredient_product_id: "pickles", state: "removed", count: 0 })] }),
    ]);
    expect(out).toEqual([]);
  });

  it("an AD-HOC addition moves no stock — there is no trustworthy portion size", () => {
    const out = buildStockDecrements([
      line({ product_id: "menu-1", modifiers: [mod({ ingredient_product_id: "x", ingredient_qty: 50, is_adhoc: true })] }),
    ]);
    expect(out).toEqual([]);
  });

  // THE rounding rule: once, at the whole line. round(2.5*4)=10, not 12.
  it("integerises ONCE at the line, never per unit", () => {
    const out = buildStockDecrements([
      line({ product_id: "menu-1", quantity: 4, modifiers: [mod({ ingredient_product_id: "ing", ingredient_qty: 2.5, count: 1 })] }),
    ]);
    expect(out).toEqual([{ product_id: "ing", quantity: 10 }]);
    expect(out[0].quantity).not.toBe(12); // what per-unit rounding would give
  });

  it("multiplies qty × count × line quantity", () => {
    const out = buildStockDecrements([
      line({ product_id: "menu-1", quantity: 2, modifiers: [mod({ ingredient_product_id: "ing", ingredient_qty: 20, count: 3 })] }),
    ]);
    expect(out).toEqual([{ product_id: "ing", quantity: 120 }]);
  });

  it("aggregates the same ingredient across lines into one decrement", () => {
    const out = buildStockDecrements([
      line({ product_id: "menu-1", modifiers: [mod({ ingredient_product_id: "bread", ingredient_qty: 1 })] }),
      line({ product_id: "menu-2", modifiers: [mod({ ingredient_product_id: "bread", ingredient_qty: 2 })] }),
    ]);
    expect(out).toEqual([{ product_id: "bread", quantity: 3 }]);
  });

  it("aggregates plain lines of the same product too", () => {
    const out = buildStockDecrements([line({ quantity: 2 }), line({ quantity: 3 })]);
    expect(out).toEqual([{ product_id: "prod-1", quantity: 5 }]);
  });

  it("drops a zero or negative computed quantity rather than emitting it", () => {
    const out = buildStockDecrements([
      line({ product_id: "menu-1", modifiers: [mod({ ingredient_product_id: "ing", ingredient_qty: 0 })] }),
    ]);
    expect(out).toEqual([]);
  });

  it("an EMPTY modifier array falls through to rule 3 — the line decrements itself", () => {
    // `modifiers.length > 0` is the condition, so [] is NOT "has components".
    expect(buildStockDecrements([line({ modifiers: [], quantity: 2 })])).toEqual([
      { product_id: "prod-1", quantity: 2 },
    ]);
  });

  it("handles an empty cart", () => {
    expect(buildStockDecrements([])).toEqual([]);
  });
});

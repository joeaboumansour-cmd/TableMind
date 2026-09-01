// =============================================
// Characterization: src/lib/products/kind.ts
//
// Invariant #16. The `!== "ingredient"` vs `=== "sellable"` distinction is a
// shop-stopping bug, not a style preference, and it is exactly the kind of
// thing a refactor "tidies up" — so it gets its own explicit test.
// =============================================

import { describe, it, expect } from "vitest";
import { isSellable, isIngredient, normaliseKind, formatStock, STOCK_UNITS } from "@/lib/products/kind";

describe("isSellable", () => {
  it("is true for an explicit sellable", () => {
    expect(isSellable({ kind: "sellable" })).toBe(true);
  });

  it("is false ONLY for an explicit ingredient", () => {
    expect(isSellable({ kind: "ingredient" })).toBe(false);
  });

  // THE test. A device whose IndexedDB predates migration 030 has kind
  // undefined on every row. Under `=== "sellable"` that till shows an EMPTY
  // CATALOGUE on the busiest screen in the app, offline, with no way out.
  it("DEFAULTS TO SELLABLE when kind is missing (pre-030 cached rows)", () => {
    expect(isSellable({})).toBe(true);
    expect(isSellable({ kind: undefined })).toBe(true);
    expect(isSellable({ kind: null })).toBe(true);
  });

  it("defaults to sellable for an unrecognised kind", () => {
    expect(isSellable({ kind: "something_new" })).toBe(true);
  });
});

describe("isIngredient", () => {
  it("is the strict inverse — only an explicit ingredient counts", () => {
    expect(isIngredient({ kind: "ingredient" })).toBe(true);
    expect(isIngredient({ kind: "sellable" })).toBe(false);
    expect(isIngredient({})).toBe(false);
    expect(isIngredient({ kind: null })).toBe(false);
  });

  it("is never both sellable and an ingredient", () => {
    for (const kind of ["sellable", "ingredient", undefined, null, "junk"]) {
      const p = { kind } as { kind?: string | null };
      expect(isSellable(p)).toBe(!isIngredient(p));
    }
  });
});

describe("normaliseKind", () => {
  it("maps anything unrecognised to sellable", () => {
    expect(normaliseKind("ingredient")).toBe("ingredient");
    expect(normaliseKind("sellable")).toBe("sellable");
    expect(normaliseKind(undefined)).toBe("sellable");
    expect(normaliseKind(null)).toBe("sellable");
    expect(normaliseKind(42)).toBe("sellable");
    expect(normaliseKind("INGREDIENT")).toBe("sellable"); // case-sensitive
  });
});

describe("formatStock", () => {
  it("omits the unit for the generic 'unit'", () => {
    expect(formatStock(12, "unit")).toBe("12");
    expect(formatStock(12, undefined)).toBe("12");
    expect(formatStock(12, null)).toBe("12");
    expect(formatStock(12, "")).toBe("12");
  });

  it("appends a real unit — never a bare number for an ingredient", () => {
    // The mitigation for the unit-mismatch failure: pickles entered as 4 jars
    // against a recipe of 20 grams drives stock to -4000 unnoticed.
    expect(formatStock(4000, "g")).toBe("4000 g");
    expect(formatStock(500, "ml")).toBe("500 ml");
  });

  it("STOCK_UNITS offers the presets the recipe editor shows", () => {
    expect(STOCK_UNITS.map((u) => u.value)).toEqual(["unit", "g", "ml", "piece"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  combineCurrencyTotals,
  computeExpectedDrawer,
  computeVariance,
} from "../lib/cashShift";
import { SELL_RATE } from "../lib/utils/format";

describe("Cash Register - Drawer Math", () => {
  describe("combineCurrencyTotals", () => {
    it("combines LL and USD into LL-equivalent using SELL_RATE", () => {
      expect(combineCurrencyTotals(100000, 1)).toBe(100000 + SELL_RATE);
    });

    it("handles zero values", () => {
      expect(combineCurrencyTotals(0, 0)).toBe(0);
      expect(combineCurrencyTotals(50000, 0)).toBe(50000);
      expect(combineCurrencyTotals(0, 2)).toBe(2 * SELL_RATE);
    });

    it("handles null/undefined as zero", () => {
      expect(combineCurrencyTotals(null as any, null as any)).toBe(0);
      expect(combineCurrencyTotals(undefined as any, 1)).toBe(SELL_RATE);
    });
  });

  describe("computeExpectedDrawer", () => {
    it("computes expected drawer: opening + cash_in - change_out + adj_in - adj_out", () => {
      const expected = computeExpectedDrawer({
        openingTotal: 500000,
        cashInTotal: 1000000,
        changeOutTotal: 50000,
        adjustmentsIn: 200000,
        adjustmentsOut: 100000,
      });
      // 500,000 + 1,000,000 - 50,000 + 200,000 - 100,000 = 1,550,000
      expect(expected).toBe(1550000);
    });

    it("handles a simple day with no adjustments", () => {
      const expected = computeExpectedDrawer({
        openingTotal: 200000,
        cashInTotal: 800000,
        changeOutTotal: 0,
        adjustmentsIn: 0,
        adjustmentsOut: 0,
      });
      expect(expected).toBe(1000000);
    });

    it("handles a day with only cash out (owner took money)", () => {
      const expected = computeExpectedDrawer({
        openingTotal: 300000,
        cashInTotal: 500000,
        changeOutTotal: 0,
        adjustmentsIn: 0,
        adjustmentsOut: 150000,
      });
      expect(expected).toBe(650000);
    });

    it("handles a day with only cash in (owner added money)", () => {
      const expected = computeExpectedDrawer({
        openingTotal: 100000,
        cashInTotal: 400000,
        changeOutTotal: 0,
        adjustmentsIn: 250000,
        adjustmentsOut: 0,
      });
      expect(expected).toBe(750000);
    });
  });

  describe("computeVariance", () => {
    it("returns positive variance for overage", () => {
      expect(computeVariance(1100000, 1000000)).toBe(100000);
    });

    it("returns negative variance for shortage", () => {
      expect(computeVariance(900000, 1000000)).toBe(-100000);
    });

    it("returns zero for exact match", () => {
      expect(computeVariance(1000000, 1000000)).toBe(0);
    });

    it("returns null when no closing count recorded", () => {
      expect(computeVariance(null, 1000000)).toBeNull();
      expect(computeVariance(undefined, 1000000)).toBeNull();
    });
  });
});

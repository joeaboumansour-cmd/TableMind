import { describe, it, expect } from "vitest";
import {
  combineCurrencyTotals,
  computeExpectedDrawer,
  computeVariance,
} from "../lib/cashShift";
import {
  SELL_RATE,
  LL_ROUND_UNIT,
  roundToNearest5k,
  convertUsdToLl,
  convertUsdToLlForReturn,
} from "../lib/utils/format";

describe("Cash Register - Drawer Math", () => {
  describe("roundToNearest5k", () => {
    it("rounds 186,300 down to 185,000 (example: $2.07 × 90,000)", () => {
      expect(roundToNearest5k(186300)).toBe(185000);
    });

    it("rounds 209,200 up to 210,000", () => {
      expect(roundToNearest5k(209200)).toBe(210000);
    });

    it("rounds exact multiples of 5k to themselves", () => {
      expect(roundToNearest5k(0)).toBe(0);
      expect(roundToNearest5k(5000)).toBe(5000);
      expect(roundToNearest5k(100000)).toBe(100000);
      expect(roundToNearest5k(185000)).toBe(185000);
    });

    it("rounds 2,499 down to 0 and 2,500 up to 5,000", () => {
      expect(roundToNearest5k(2499)).toBe(0);
      expect(roundToNearest5k(2500)).toBe(5000);
    });

    it("exports the correct round unit constant", () => {
      expect(LL_ROUND_UNIT).toBe(5000);
    });
  });

  describe("convertUsdToLl", () => {
    it("converts $2.07 to 185,000 LL (rounded from 186,300)", () => {
      expect(convertUsdToLl(2.07)).toBe(185000);
    });

    it("converts whole-dollar amounts that are already multiples of 5k", () => {
      expect(convertUsdToLl(1)).toBe(90000);
      expect(convertUsdToLl(2)).toBe(180000);
    });
  });

  describe("convertUsdToLlForReturn", () => {
    it("converts at RETURN_RATE (89,000) and rounds to nearest 5k", () => {
      // $2.07 × 89,000 = 184,230 → rounded to 185,000
      expect(convertUsdToLlForReturn(2.07)).toBe(185000);
    });

    it("converts whole-dollar amounts", () => {
      // $1 × 89,000 = 89,000 → rounds up to 90,000 (nearest 5k)
      expect(convertUsdToLlForReturn(1)).toBe(90000);
      // $2 × 89,000 = 178,000 → already a multiple of 5k
      expect(convertUsdToLlForReturn(2)).toBe(180000);
    });
  });

  describe("combineCurrencyTotals", () => {
    it("combines LL and USD into LL-equivalent using SELL_RATE", () => {
      expect(combineCurrencyTotals(100000, 1)).toBe(100000 + SELL_RATE);
    });

    it("rounds the USD→LL contribution to nearest 5k", () => {
      // 2.07 USD × 90,000 = 186,300 → rounded to 185,000
      expect(combineCurrencyTotals(0, 2.07)).toBe(185000);
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
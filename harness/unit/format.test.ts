// =============================================
// Characterization: src/lib/utils/format.ts
//
// The single source of truth for money in this app. These record what it does
// TODAY so the refactor can move code freely underneath them.
//
// Characterization, not specification: where current behaviour looks
// questionable it is still recorded as-is, with a comment saying so. Changing
// it is a separate, deliberate decision — not something a refactor does by
// accident. Invariants #1-#3 of the plan live here.
// =============================================

import { describe, it, expect } from "vitest";
import {
  SELL_RATE,
  RETURN_RATE,
  LL_ROUND_UNIT,
  roundToNearest5k,
  convertUsdToLl,
  convertUsdToLlForReturn,
  convertLlToUsdForSale,
  convertLlToUsdForReturn,
  formatLL,
  formatLLParts,
  formatLLCompact,
  formatUSD,
  formatCurrency,
  formatTransactionNumber,
  formatBarcode,
  truncateText,
  formatPercent,
} from "@/lib/utils/format";

describe("rates", () => {
  // The spread between these two IS the store's margin on currency. If a
  // refactor ever makes them equal, the shop loses money on every USD payment.
  it("sell and return rates are distinct, and sell is the higher", () => {
    expect(SELL_RATE).toBe(90_000);
    expect(RETURN_RATE).toBe(89_000);
    expect(SELL_RATE).toBeGreaterThan(RETURN_RATE);
  });

  it("the LL rounding unit is 5,000", () => {
    expect(LL_ROUND_UNIT).toBe(5_000);
  });
});

describe("roundToNearest5k", () => {
  it("rounds to the nearest multiple of 5,000", () => {
    expect(roundToNearest5k(186_300)).toBe(185_000);
    expect(roundToNearest5k(209_200)).toBe(210_000);
    expect(roundToNearest5k(0)).toBe(0);
    expect(roundToNearest5k(5_000)).toBe(5_000);
  });

  it("rounds a halfway value UP (Math.round behaviour)", () => {
    expect(roundToNearest5k(2_500)).toBe(5_000);
    expect(roundToNearest5k(7_500)).toBe(10_000);
  });

  it("rounds small amounts to zero", () => {
    // Anything under 2,500 LL becomes free. Correct given there is no bill
    // smaller than 5,000, but worth seeing stated.
    expect(roundToNearest5k(2_499)).toBe(0);
    expect(roundToNearest5k(1)).toBe(0);
  });

  it("negative amounts round toward zero at the halfway point", () => {
    // Math.round(-0.5) is -0, so -2,500 yields -0 rather than -5,000.
    // Recorded because change/refund paths can produce negatives.
    expect(roundToNearest5k(-2_500)).toBe(-0);
    expect(roundToNearest5k(-7_500)).toBe(-5_000);
    expect(roundToNearest5k(-186_300)).toBe(-185_000);
  });
});

describe("convertUsdToLl (customer pays — SELL_RATE)", () => {
  it("converts at 90,000 and rounds to 5k", () => {
    expect(convertUsdToLl(1)).toBe(90_000);
    expect(convertUsdToLl(2.07)).toBe(185_000); // 186,300 -> 185,000
    expect(convertUsdToLl(0)).toBe(0);
  });

  it("a sub-cent amount rounds away entirely", () => {
    expect(convertUsdToLl(0.01)).toBe(0); // 900 -> 0
  });

  it("is NOT the same as raw multiplication — the rounding is the point", () => {
    expect(convertUsdToLl(2.07)).not.toBe(2.07 * SELL_RATE);
  });
});

describe("convertUsdToLlForReturn (money going back — RETURN_RATE)", () => {
  it("converts at 89,000 and rounds to 5k", () => {
    expect(convertUsdToLlForReturn(1)).toBe(90_000); // 89,000 -> 90,000
    expect(convertUsdToLlForReturn(2)).toBe(180_000); // 178,000 -> 180,000
  });

  it("values a USD payment BELOW what the same dollars buy", () => {
    // The spread, at the amounts where rounding does not mask it.
    expect(convertUsdToLlForReturn(10)).toBeLessThan(convertUsdToLl(10));
  });
});

describe("LL -> USD", () => {
  it("sale uses 90,000 and does NOT round", () => {
    expect(convertLlToUsdForSale(90_000)).toBe(1);
    expect(convertLlToUsdForSale(185_000)).toBeCloseTo(2.0556, 4);
  });

  it("return uses 89,000 and does NOT round", () => {
    expect(convertLlToUsdForReturn(89_000)).toBe(1);
    expect(convertLlToUsdForReturn(185_000)).toBeCloseTo(2.0787, 4);
  });

  it("the same LL is worth MORE dollars on the return rate", () => {
    // Which is why using the wrong one silently leaks money.
    expect(convertLlToUsdForReturn(100_000)).toBeGreaterThan(convertLlToUsdForSale(100_000));
  });
});

describe("formatLL", () => {
  it("groups thousands and appends the unit", () => {
    expect(formatLL(185_000)).toBe("185,000 LL");
    expect(formatLL(0)).toBe("0 LL");
    expect(formatLL(1_500_000)).toBe("1,500,000 LL");
  });

  it("rounds fractions away — the LL has no sub-unit", () => {
    // This is the History "Avg. sale" fix: total/count must not print
    // "671,666.667 LL".
    expect(formatLL(671_666.667)).toBe("671,667 LL");
  });

  it("treats NaN and null-ish input as zero rather than printing NaN", () => {
    expect(formatLL(NaN)).toBe("0 LL");
    expect(formatLL(undefined as unknown as number)).toBe("0 LL");
  });

  it("does NOT round to 5k — that is a different rule", () => {
    // Presentation vs what a customer can physically pay.
    expect(formatLL(186_300)).toBe("186,300 LL");
  });
});

describe("formatLLParts", () => {
  it("splits into digits and unit without re-implementing the formatting", () => {
    expect(formatLLParts(185_000)).toEqual({ value: "185,000", unit: "LL" });
    expect(formatLLParts(0)).toEqual({ value: "0", unit: "LL" });
  });
});

describe("formatLLCompact (axis ticks only)", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatLLCompact(70_000)).toBe("70k");
    expect(formatLLCompact(1_000_000)).toBe("1M");
    expect(formatLLCompact(1_500_000)).toBe("1.5M");
    expect(formatLLCompact(500)).toBe("500");
  });

  it("drops precision below 1M — deliberately approximate", () => {
    expect(formatLLCompact(70_400)).toBe("70k");
    expect(formatLLCompact(70_600)).toBe("71k");
  });

  it("handles negatives by magnitude", () => {
    expect(formatLLCompact(-70_000)).toBe("-70k");
  });
});

describe("formatUSD", () => {
  it("always shows two decimals", () => {
    expect(formatUSD(2)).toBe("$2.00");
    expect(formatUSD(2.055)).toBe("$2.06");
    expect(formatUSD(0)).toBe("$0.00");
  });

  it("renders negatives with the sign before the symbol", () => {
    // "$-5.00", not "-$5.00". Recorded as-is; it is a display oddity, not a
    // money bug, and changing it is a UI decision rather than a refactor.
    expect(formatUSD(-5)).toBe("$-5.00");
  });
});

describe("formatCurrency", () => {
  it("delegates LL to formatLL", () => {
    expect(formatCurrency(185_000, "LL")).toBe("185,000 LL");
  });

  it("uses Intl for USD", () => {
    expect(formatCurrency(2.5, "USD")).toBe("$2.50");
  });
});

describe("misc formatters", () => {
  it("formatTransactionNumber pads to the requested width", () => {
    expect(formatTransactionNumber("TXN", 42)).toBe("TXN-000042");
    expect(formatTransactionNumber("TXN", 42, 3)).toBe("TXN-042");
  });

  it("formatBarcode groups digits in fours", () => {
    expect(formatBarcode("1234567890")).toBe("1234 5678 90");
    expect(formatBarcode("123")).toBe("123");
  });

  it("truncateText counts the ellipsis inside maxLength", () => {
    expect(truncateText("abcdefghij", 8)).toBe("abcde...");
    expect(truncateText("abc", 8)).toBe("abc");
  });

  it("formatPercent defaults to one decimal", () => {
    expect(formatPercent(12.34)).toBe("12.3%");
    expect(formatPercent(12.34, 0)).toBe("12%");
  });
});

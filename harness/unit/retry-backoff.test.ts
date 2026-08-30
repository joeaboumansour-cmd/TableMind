// =============================================
// Characterization: computeRetryBackoffMs (src/lib/db/localDB.ts)
//
// 30s → 1m → 5m → 15m → 1h, with ±20% jitter.
//
// The jitter is deliberate and means this cannot be asserted on exact values —
// so these test the SCHEDULE and the BOUNDS instead. Pinning exact numbers
// would require stubbing Math.random, which would test the stub rather than
// the property that actually matters: that a shop full of devices coming back
// on one router does not retry in lockstep.
// =============================================

import { describe, it, expect } from "vitest";
import { computeRetryBackoffMs } from "@/lib/db/localDB";

const BASE = [30_000, 60_000, 300_000, 900_000, 3_600_000];

describe("computeRetryBackoffMs", () => {
  it("follows the 30s → 1m → 5m → 15m → 1h schedule, within ±20%", () => {
    BASE.forEach((base, i) => {
      const attempt = i + 1;
      for (let n = 0; n < 50; n++) {
        const ms = computeRetryBackoffMs(attempt);
        expect(ms).toBeGreaterThanOrEqual(base * 0.8 - 1);
        expect(ms).toBeLessThanOrEqual(base * 1.2 + 1);
      }
    });
  });

  it("clamps past the end of the schedule to the 1h step", () => {
    for (const attempt of [5, 6, 20, 1000]) {
      const ms = computeRetryBackoffMs(attempt);
      expect(ms).toBeGreaterThanOrEqual(3_600_000 * 0.8 - 1);
      expect(ms).toBeLessThanOrEqual(3_600_000 * 1.2 + 1);
    }
  });

  it("treats attempt 0 and negatives as the first attempt", () => {
    for (const attempt of [0, -1, -100]) {
      const ms = computeRetryBackoffMs(attempt);
      expect(ms).toBeGreaterThanOrEqual(30_000 * 0.8 - 1);
      expect(ms).toBeLessThanOrEqual(30_000 * 1.2 + 1);
    }
  });

  it("never returns less than 1 second", () => {
    for (let n = 0; n < 200; n++) {
      expect(computeRetryBackoffMs(1)).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("actually jitters — repeated calls are not identical", () => {
    // If this ever fails, the lockstep-retry protection is gone.
    const seen = new Set(Array.from({ length: 40 }, () => computeRetryBackoffMs(1)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns whole milliseconds", () => {
    for (let n = 0; n < 20; n++) {
      expect(Number.isInteger(computeRetryBackoffMs(2))).toBe(true);
    }
  });
});

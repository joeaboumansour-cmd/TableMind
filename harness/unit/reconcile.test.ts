// =============================================
// Characterization: evaluateReconcile (src/lib/products/refresh.ts)
//
// Invariant #8 — DELETION REQUIRES POSITIVE PROOF.
//
// This function decides whether it is safe to delete cached products missing
// from a fetched id set. Getting it wrong is expensive and has happened: an
// earlier version deleted based on an unpaginated query that PostgREST
// truncates at 1,000 rows, wiping every product past the cap on larger stores
// and then re-pulling them — a permanent delete/refetch loop.
//
// The asymmetry is the whole design: skipping is ALWAYS safe (a stale product
// lingers one cycle), deleting on bad evidence is not. Every ambiguous case
// below must therefore resolve to reconcile:false.
// =============================================

import { describe, it, expect } from "vitest";
import { evaluateReconcile } from "@/lib/products/refresh";

describe("evaluateReconcile — refuses without proof", () => {
  it("skips when the live count is unknown", () => {
    const d = evaluateReconcile({ cachedCount: 100, liveCount: null, fetchedIdCount: 100 });
    expect(d.reconcile).toBe(false);
  });

  it("skips when the id fetch failed, even with a known live count", () => {
    const d = evaluateReconcile({ cachedCount: 100, liveCount: 50, fetchedIdCount: null });
    expect(d.reconcile).toBe(false);
  });

  // The 1,000-row truncation, exactly as it presented in production.
  it("skips when fewer ids came back than the store reports (truncation)", () => {
    const d = evaluateReconcile({ cachedCount: 2500, liveCount: 2400, fetchedIdCount: 1000 });
    expect(d.reconcile).toBe(false);
    if (!d.reconcile) expect(d.reason).toContain("1000");
  });

  it("skips when MORE ids came back than reported (concurrent write)", () => {
    const d = evaluateReconcile({ cachedCount: 100, liveCount: 90, fetchedIdCount: 95 });
    expect(d.reconcile).toBe(false);
  });
});

describe("evaluateReconcile — the cheap skip", () => {
  it("skips when the cache is not ahead of the server", () => {
    // Nothing stale can exist, so the full id sweep is unnecessary. This is
    // the common case and the reason boot does not always pay for it.
    expect(evaluateReconcile({ cachedCount: 50, liveCount: 100, fetchedIdCount: null }).reconcile).toBe(false);
    expect(evaluateReconcile({ cachedCount: 100, liveCount: 100, fetchedIdCount: null }).reconcile).toBe(false);
  });

  it("skips an empty cache against an empty server", () => {
    expect(evaluateReconcile({ cachedCount: 0, liveCount: 0, fetchedIdCount: 0 }).reconcile).toBe(false);
  });
});

describe("evaluateReconcile — the ONLY case that deletes", () => {
  it("reconciles when the cache is ahead AND the id set is provably complete", () => {
    const d = evaluateReconcile({ cachedCount: 120, liveCount: 100, fetchedIdCount: 100 });
    expect(d.reconcile).toBe(true);
  });

  it("reconciles down to an emptied store, when proven", () => {
    // Every product genuinely deleted server-side: live 0, fetched 0.
    expect(evaluateReconcile({ cachedCount: 40, liveCount: 0, fetchedIdCount: 0 }).reconcile).toBe(true);
  });

  it("needs BOTH conditions — either alone is not enough", () => {
    // Ahead, but unproven.
    expect(evaluateReconcile({ cachedCount: 120, liveCount: 100, fetchedIdCount: 99 }).reconcile).toBe(false);
    // Proven, but not ahead.
    expect(evaluateReconcile({ cachedCount: 100, liveCount: 100, fetchedIdCount: 100 }).reconcile).toBe(false);
  });
});

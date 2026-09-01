// =============================================
// Durability classification (src/lib/pwa/durability.ts)
//
// Phase 6.1's exit criterion is that "the 'at risk' state is impossible to be
// in without the shop being told". That has two halves: showing it, and
// deciding it. This is the deciding half, and it is the half that can be
// asserted.
//
// What is at stake: `offline_queue` holds completed sales whose cash is already
// in the drawer. Whether they survive is a property of the BROWSER, not of this
// app's code, so the till has to notice and say so.
// =============================================

import { describe, it, expect } from "vitest";
import {
  classifyDurability,
  type DurabilityFacts,
} from "@/lib/pwa/durability";

const facts = (over: Partial<DurabilityFacts> = {}): DurabilityFacts => ({
  supported: true,
  persisted: true,
  nearFull: false,
  usageRatio: 0.1,
  queuedSales: 0,
  deadLettered: 0,
  ...over,
});

describe("when money is at risk", () => {
  it("is URGENT when sales are queued on an evictable device", () => {
    const d = classifyDurability(facts({ persisted: false, queuedSales: 3 }));
    expect(d.level).toBe("at_risk");
    expect(d.urgent).toBe(true);
    // The number is the point — "some sales" is not something a shop can act on.
    expect(d.headline).toContain("3");
  });

  it("says 'sale is' for one and 'sales are' for more, because a shop reads this", () => {
    expect(classifyDurability(facts({ persisted: false, queuedSales: 1 })).headline)
      .toContain("sale is");
    expect(classifyDurability(facts({ persisted: false, queuedSales: 2 })).headline)
      .toContain("sales are");
  });

  it("is NOT urgent when the device is evictable but nothing is queued", () => {
    // Nothing to lose yet. Worth saying once; not worth a permanent warning
    // that teaches the shop to ignore permanent warnings.
    const d = classifyDurability(facts({ persisted: false, queuedSales: 0 }));
    expect(d.level).toBe("unprotected");
    expect(d.urgent).toBe(false);
  });

  it("is NOT urgent when the grant was given, however many sales are queued", () => {
    const d = classifyDurability(facts({ persisted: true, queuedSales: 40 }));
    expect(d.level).toBe("protected");
    expect(d.urgent).toBe(false);
  });
});

describe("a full disk outranks an evictable one", () => {
  it("reports 'full' even when the grant WAS given", () => {
    // Persistence does not create space. The next sale fails either way, which
    // is a certainty rather than a risk — hence the higher severity.
    const d = classifyDurability(facts({ persisted: true, nearFull: true }));
    expect(d.level).toBe("full");
    expect(d.urgent).toBe(true);
  });

  it("still names the queued sales when both problems are present", () => {
    const d = classifyDurability(
      facts({ persisted: false, nearFull: true, queuedSales: 5 })
    );
    expect(d.level).toBe("full");
    expect(d.detail).toContain("5");
  });
});

describe("an absent answer is not a negative answer", () => {
  it("reports 'unknown' rather than claiming either answer on an old browser", () => {
    // The rule this codebase keeps relearning — evaluateReconcile, P1-12,
    // P1-13, the cleared catalogue. Do not tell a shop its sales are safe, and
    // do not tell them they are not, when the browser cannot say.
    const d = classifyDurability(facts({ supported: false, persisted: false, queuedSales: 9 }));
    expect(d.level).toBe("unknown");
    expect(d.urgent).toBe(false);
  });

  it("does not let an unsupported browser be reported as protected either", () => {
    const d = classifyDurability(facts({ supported: false, persisted: true }));
    expect(d.level).toBe("unknown");
  });
});

describe("dead-lettered sales are a different problem", () => {
  it("does not drive the durability level", () => {
    // A sale the SERVER refused is not a storage problem, and the transactions
    // page already lists those. Carried in the facts for the admin trail, but
    // it must not turn a healthy device into a warning.
    const d = classifyDurability(facts({ deadLettered: 4 }));
    expect(d.level).toBe("protected");
    expect(d.facts.deadLettered).toBe(4);
  });
});

// =============================================
// Storage eviction order (src/lib/db/localDB.ts)
//
// Phase 6.2 asks for two things: that the order be formalised, and that
// "queued sales are never shed" be ASSERTED. This is the assertion.
//
// It is deliberately a test of the DATA the shedding loop walks, not of a
// comment beside it. `freeExpendableSpace()` iterates `EVICTION_ORDER` and
// touches nothing else, so a future edit that adds `offline_queue` to that list
// — the one mistake that would lose a shop real money on a full disk — turns
// this suite red instead of turning up in a stock take.
//
// A full disk is not hypothetical here. Every till writes completed sales to
// IndexedDB before the network sees them, and `withQuotaRetry` calls this the
// moment a write hits QuotaExceededError.
// =============================================

import { describe, it, expect } from "vitest";
import { EVICTION_ORDER, NEVER_EVICTED } from "@/lib/db/localDB";

const tables = EVICTION_ORDER.map((s) => s.table);

describe("what may be shed under storage pressure", () => {
  it("NEVER sheds queued sales", () => {
    // The money. `offline_queue` holds completed sales whose cash is already in
    // the drawer, and localDB dead-letters rather than deletes them even after
    // retries are exhausted — that promise is worth nothing if a quota error
    // can clear the table instead.
    expect(tables).not.toContain("offline_queue");
    expect(NEVER_EVICTED).toContain("offline_queue");
  });

  it("NEVER sheds the product cache", () => {
    // It would free the most, which is exactly the trap. It is also the only
    // thing letting the till sell while offline, so dropping it to save one row
    // takes the whole shop down instead of one write.
    expect(tables).not.toContain("products_cache");
    expect(NEVER_EVICTED).toContain("products_cache");
  });

  it("sheds the cheapest thing first and the dearest last", () => {
    // Activity events are a diagnostic convenience and must go ahead of
    // everything: a log buffer may never be the reason a completed sale cannot
    // be written. The history cache is a pure read convenience after that.
    expect(tables).toEqual(["activity_buffer", "transactions_cache", "pending_writes"]);
  });

  it("sheds ONLY cosmetic pending writes, never a queued money write", () => {
    // pending_writes is a mixed bag: a starred product sits beside a cash-shift
    // open and a product reprice. Clearing the table wholesale would drop a
    // price change or a drawer movement the server has never seen.
    const step = EVICTION_ORDER.find((s) => s.table === "pending_writes");
    expect(step && "onlyTypes" in step).toBe(true);

    const types = (step as { onlyTypes: readonly string[] }).onlyTypes;
    expect([...types].sort()).toEqual(["favorite_add", "favorite_remove"]);

    for (const moneyWrite of [
      "cash_shift_open",
      "cash_shift_close",
      "cash_adjustment",
      "register_create",
      "product_upsert",
    ]) {
      expect(types).not.toContain(moneyWrite);
    }
  });

  it("names a reason for every step, because these lines only ever run in an emergency", () => {
    for (const step of EVICTION_ORDER) {
      expect(step.why.length).toBeGreaterThan(0);
    }
  });
});

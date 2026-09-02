// =============================================
// Regression lock — bug-0003.
//
// The production guard's blocklist is HARDCODED on purpose: a guard that
// depends on configuration being correct is not a guard, because the thing it
// protects against is configuration being wrong.
//
// The cost of that design is that the list can go stale silently, and on
// 2026-09-01 it did. The database moved Seoul -> Ireland and the constant was
// not updated, so the guard named only the abandoned project and would have
// waved through a seed-and-mutate run against the live one.
//
// Nothing detected that, because a guard that says "ok" looks exactly like a
// guard that is working. This test is the thing that would have.
//
// It runs in `harness:unit` — no database, no secrets, on every push.
// =============================================

import { describe, it, expect } from "vitest";
import { PRODUCTION_HOSTS } from "../guard/assert-not-production.mjs";

/**
 * Every Supabase project that has ever served real stores.
 *
 * ADD TO THIS LIST WHEN THE DATABASE MOVES, in the same commit as the move.
 * Removing an entry is never correct: a stale `.env` pointed at a
 * decommissioned project is its own kind of bad run, and the guard refusing it
 * costs nothing.
 */
const KNOWN_PRODUCTION_REFS = [
  { ref: "slxqufndzuuetykqmtfa", where: "Ireland (eu-west-1), current since 2026-09-01" },
  { ref: "xflmpowmxcuiqxzhuqbl", where: "Seoul, production before 2026-09-01" },
];

describe("production guard blocklist", () => {
  for (const { ref, where } of KNOWN_PRODUCTION_REFS) {
    it(`blocks ${ref} — ${where}`, () => {
      expect(PRODUCTION_HOSTS.has(`${ref}.supabase.co`)).toBe(true);
    });
  }

  it("never shrinks below every production project we have ever had", () => {
    expect(PRODUCTION_HOSTS.size).toBeGreaterThanOrEqual(KNOWN_PRODUCTION_REFS.length);
  });
});

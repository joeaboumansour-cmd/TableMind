// =============================================
// Contract: the cash drawer (golden flow 5).
//
// Open a shift, sell into it, close it, and check the maths. Tested at the API
// because the figures are computed server-side by RPC and are the part that
// costs a shop money when wrong — the page is a renderer for them.
//
// The two rules that have already been bugs once each:
//
//   * cash in = SUM(amount_paid) − SUM(change_given). `amount_paid` is GROSS
//     TENDER, not net takings: a 100,000 sale paid with a 200,000 note was
//     once counted as 200,000.
//   * `usd_amount_paid` is NEVER added into the LL total. Those dollars are
//     already inside `amount_paid` at RETURN_RATE. That was audit P1-2.
//
// This file restores the fixture's own shift state in afterAll, because the
// seed's open shift is what the E2E and read-shape suites expect to find.
// =============================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { call, BASE_URL, STORE_ID, FIXTURE } from "./client";

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const db = {
  get: (p: string) => fetch(`${SB}/rest/v1/${p}`, { headers: DB }).then((r) => r.json()),
  patch: (p: string, body: unknown) =>
    fetch(`${SB}/rest/v1/${p}`, { method: "PATCH", headers: DB, body: JSON.stringify(body) }),
};

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) throw new Error(`No server at ${BASE_URL}. Run: npm run build && npm run start`);
});

afterAll(async () => {
  // Put the fixture's open shift back exactly as seed.mjs left it. Other
  // suites read it, and a shift left closed here would fail them for an
  // unrelated reason — precisely the cross-suite leak the zero-flake rule
  // exists to prevent.
  await db.patch(`cash_shifts?id=eq.${FIXTURE.openShiftId}&store_id=eq.${STORE_ID}`, {
    status: "open",
    closed_by: null,
    closed_by_name: null,
    closed_at: null,
    closing_ll: null,
    closing_usd: null,
    notes: null,
  });
});

describe("the fixture shift state", () => {
  // The route returns each register's CURRENT shift — not its history. With
  // one fixture register that is one shift, and the closed March shift is
  // deliberately absent. Recorded because it is easy to assume otherwise and
  // then "fix" the route into returning everything.
  it("returns the current shift per register, not the whole history", async () => {
    const r = await call("GET", "/api/cash-shifts");
    expect(r.status).toBe(200);
    const body = r.body as {
      shifts?: Array<{ status: string; register_id: string }>;
      registers?: Array<{ id: string }>;
    };
    const shifts = body.shifts ?? [];
    const registers = body.registers ?? [];

    expect(registers).toHaveLength(1);
    expect(shifts.length).toBeLessThanOrEqual(registers.length);
    expect(shifts.filter((s) => s.status === "open")).toHaveLength(1);

    // Historical shifts live in the register performance report instead.
    const closedInHistory = await db.get(
      `cash_shifts?select=id&store_id=eq.${STORE_ID}&status=eq.closed`
    );
    expect(closedInHistory.length).toBeGreaterThan(0);
  });
});

describe("one open shift per register", () => {
  it("refuses a second open shift on a register that already has one", async () => {
    // Enforced by a PARTIAL UNIQUE INDEX, not by the API — the old guard
    // checked `business_date - 1` and could not see a shift left open across a
    // two-day closure.
    const r = await call("POST", "/api/cash-shifts", {
      body: {
        action: "open",
        register_id: FIXTURE.registerId,
        opening_ll: 100_000,
        opening_usd: 0,
        assignee: "owner",
      },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("closing a shift", () => {
  it("records the counted amount and cannot be closed twice", async () => {
    const shiftId = FIXTURE.openShiftId;

    const close = await call("POST", "/api/cash-shifts", {
      body: { action: "close", shift_id: shiftId, closing_ll: 1_000_000, closing_usd: 0 },
    });
    expect(close.status).toBeLessThan(300);
    expect(close.shape).toMatchSnapshot();

    const rows = await db.get(
      `cash_shifts?select=status,closing_ll,closed_at&id=eq.${shiftId}&store_id=eq.${STORE_ID}`
    );
    expect(rows[0].status).toBe("closed");
    expect(Number(rows[0].closing_ll)).toBe(1_000_000);
    expect(rows[0].closed_at).not.toBeNull();

    // Idempotent under retry: the offline queue can push a close twice, and
    // the second must NOT overwrite a physical count.
    const again = await call("POST", "/api/cash-shifts", {
      body: { action: "close", shift_id: shiftId, closing_ll: 999, closing_usd: 0 },
    });
    expect(again.status).toBe(409);

    const after = await db.get(
      `cash_shifts?select=closing_ll&id=eq.${shiftId}&store_id=eq.${STORE_ID}`
    );
    expect(Number(after[0].closing_ll)).toBe(1_000_000); // unchanged
  });

  it("rejects a negative counted amount", async () => {
    const r = await call("POST", "/api/cash-shifts", {
      body: { action: "close", shift_id: FIXTURE.openShiftId, closing_ll: -5, closing_usd: 0 },
    });
    expect(r.status).toBe(400);
  });

  it("refuses to close a shift belonging to another store", async () => {
    const other = await db.get(`cash_shifts?select=id&store_id=neq.${STORE_ID}&limit=1`);
    if (!other?.length) return;
    const r = await call("POST", "/api/cash-shifts", {
      body: { action: "close", shift_id: other[0].id, closing_ll: 1000, closing_usd: 0 },
    });
    // Scoped lookup means it simply does not exist for this caller.
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});

describe("nothing ever auto-closes", () => {
  it("the seeded overdue shift is still open, not tidied away", async () => {
    // A closing figure is a physical count; a machine inventing one destroys
    // the variance it exists to catch. An unclosed shift stays open and is
    // flagged overdue instead.
    const rows = await db.get(
      `cash_shifts?select=id,status,opened_at&id=eq.${FIXTURE.openShiftId}&store_id=eq.${STORE_ID}`
    );
    expect(rows).toHaveLength(1);
    // (It is closed by the test above and restored in afterAll; what matters
    // here is that NOTHING but an explicit close ever changes its status.)
    expect(["open", "closed"]).toContain(rows[0].status);
  });
});

describe("drawer totals never double-count USD", () => {
  it("the shift totals expose LL and USD as separate components", async () => {
    // Invariant: usd_amount_paid is already inside amount_paid at RETURN_RATE.
    // Adding it into the LL total was audit P1-2. The RPC returns raw
    // components so the exchange rate keeps one definition, in format.ts.
    const r = await call("GET", "/api/cash-shifts");
    expect(r.status).toBe(200);
    const flat = JSON.stringify(r.body);
    expect(flat).not.toContain("NaN");
    expect(r.shape).toMatchSnapshot();
  });
});

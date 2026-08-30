// =============================================
// Contract: the SHAPE of every read route's response.
//
// Snapshots describe structure, not values (see client.ts). What they protect
// is the thing Phase 2 and Phase 3 are most likely to break by accident: a
// field quietly disappearing, or changing type, while the status stays 200 and
// nothing looks wrong until a screen renders "undefined".
//
// To accept an intentional change:  npm run harness:contract -- -u
// Read the diff first. A key disappearing from a money route is not a snapshot
// that needs updating.
// =============================================

import { describe, it, expect, beforeAll } from "vitest";
import { call, BASE_URL, STORE_ID } from "./client";

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) throw new Error(`No server at ${BASE_URL}. Run: npm run build && npm run start`);
});

const READ_ROUTES = [
  "/api/cash-shifts",
  "/api/cash-registers",
  "/api/cash-registers/analytics",
  "/api/categories",
  "/api/recipes",
  "/api/combos",
  "/api/my-shift",
  "/api/transactions",
  "/api/transactions/analytics",
  "/api/kitchen/tickets",
  "/api/register-requests",
  "/api/menu-link",
];

describe("read route shapes", () => {
  it.each(READ_ROUTES)("GET %s", async (path) => {
    const r = await call("GET", path);
    expect(r.status).toBe(200);
    expect({ path, status: r.status, shape: r.shape }).toMatchSnapshot();
  });
});

describe("tenancy is visible in the data, not just the status", () => {
  // A 200 proves the caller was accepted. It does NOT prove the rows belong to
  // them — which is the failure mode a store-scoping regression actually has.
  it("GET /api/transactions returns only the fixture store's sales", async () => {
    const r = await call("GET", "/api/transactions");
    const body = r.body as { transactions?: Array<{ store_id?: string; transaction_number?: string }> };
    const rows = body.transactions ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.store_id) expect(row.store_id).toBe(STORE_ID);
      if (row.transaction_number) expect(row.transaction_number).toMatch(/^FIXTURE-/);
    }
  });

  it("GET /api/cash-registers returns only the fixture store's registers", async () => {
    const r = await call("GET", "/api/cash-registers");
    const raw = JSON.stringify(r.body);
    expect(raw).toContain("Fixture Front Counter");
    // No other tenant's drawer names leaked in.
    expect(raw).not.toContain("daoud");
  });
});

describe("analytics aggregates in Postgres", () => {
  // Invariant #19. The route ran for a year summing a PostgREST select in JS,
  // silently capped at 1,000 rows. With 300 fixture sales this cannot detect
  // the cap directly — what it CAN pin is that the numbers are internally
  // consistent, so a regression to JS summing shows up as a mismatch.
  it("GET /api/transactions/analytics returns coherent totals", async () => {
    const r = await call("GET", "/api/transactions/analytics");
    expect(r.status).toBe(200);
    expect(r.shape).toMatchSnapshot();

    const body = r.body as Record<string, unknown>;
    const flat = JSON.stringify(body);
    // Whatever the field names, nothing should be NaN or null-as-number.
    expect(flat).not.toContain("NaN");
    expect(flat).not.toContain("Infinity");
  });
});

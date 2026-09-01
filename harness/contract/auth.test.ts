// =============================================
// Contract: authentication and tenancy on every store-facing route.
//
// Invariants #21 (resolveCaller null is ALWAYS a 401, never a fallback
// identity) and #23 (never weaken a store-scoping filter to make something
// faster).
//
// This is the suite that matters most for Phase 2.2's route kernel: it
// replaces the per-file auth plumbing on every route at once, and these tests
// are the proof that it did not quietly open one of them.
// =============================================

import { describe, it, expect, beforeAll } from "vitest";
import { call, authHeaders, BASE_URL, STORE_ID } from "./client";

/** Every route that takes tenancy from the caller. */
const STORE_ROUTES: Array<[string, string]> = [
  ["GET", "/api/cash-shifts"],
  ["GET", "/api/cash-registers"],
  ["GET", "/api/cash-registers/analytics"],
  ["GET", "/api/categories"],
  ["GET", "/api/recipes"],
  ["GET", "/api/combos"],
  ["GET", "/api/my-shift"],
  ["GET", "/api/transactions"],
  ["GET", "/api/transactions/analytics"],
  ["GET", "/api/kitchen/tickets"],
  ["GET", "/api/register-requests"],
  ["GET", "/api/menu-link"],
];

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) {
    throw new Error(
      `No server at ${BASE_URL}.\n` +
      `Start one first:  npm run build && npm run start\n` +
      `(a production build — next dev compiles on demand and skews everything)`
    );
  }
});

describe("no auth header", () => {
  it.each(STORE_ROUTES)("%s %s refuses an anonymous caller", async (method, path) => {
    const r = await call(method, path, { headers: { "content-type": "application/json" } });
    // 401 is the contract. Anything 2xx here would be a tenancy hole.
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe("malformed auth header", () => {
  it.each(STORE_ROUTES)("%s %s refuses unparseable x-auth-data", async (method, path) => {
    const r = await call(method, path, {
      headers: { "content-type": "application/json", "x-auth-data": "{not json" },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it.each(STORE_ROUTES)("%s %s refuses a header with no store_id", async (method, path) => {
    const r = await call(method, path, { headers: authHeaders({ store_id: undefined }) });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe("a store_id that does not exist", () => {
  // Invariant #21: unresolvable caller is a 401, NEVER a fallback identity
  // that would read someone else's rows.
  it.each(STORE_ROUTES)("%s %s refuses an unknown store", async (method, path) => {
    const r = await call(method, path, {
      headers: authHeaders({ store_id: "00000000-0000-4000-8000-0000deadbeef" }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe("the harness store is accepted", () => {
  it.each(STORE_ROUTES)("%s %s succeeds for the fixture caller", async (method, path) => {
    const r = await call(method, path);
    expect(r.status).toBe(200);
  });
});

describe("health", () => {
  // Invariant #12 — it must stay on the Edge runtime and must never be cached.
  it("is open, cheap, and says nothing about a store", async () => {
    const r = await call("GET", "/api/health", { headers: {} });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(STORE_ID);
  });
});

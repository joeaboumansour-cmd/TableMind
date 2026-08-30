// =============================================
// Contract-test client.
//
// Phase 1.3. Records request → status + response SHAPE for every API route,
// against the seeded fixture store. This is what lets Phase 2 rewrite the
// server — the atomic sale RPC, the route kernel — without fear.
//
// WHY SHAPE AND NOT VALUES: a snapshot of literal values would break on every
// re-seed and on anything with a generated id or a timestamp, and would then
// be updated reflexively until it asserted nothing. Shape is the actual
// contract: which keys exist, what type each holds, whether a thing is an
// array. Values that matter are asserted explicitly in the test instead.
// =============================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = resolve(process.cwd(), ".env.test");

const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

export const STORE_ID = env.HARNESS_STORE_ID;
export const BASE_URL = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";

/** Fixture ids, mirrored from harness/fixtures/ids.mjs. */
export const FIXTURE = {
  managerUserId: "f0000003-0000-4000-8000-000000000001",
  cashierUserId: "f0000003-0000-4000-8000-000000000002",
  registerId: "f0000004-0000-4000-8000-000000000001",
  closedShiftId: "f0000009-0000-4000-8000-000000000001",
  openShiftId: "f0000009-0000-4000-8000-000000000002",
  firstProductId: "f0000001-0000-4000-8000-000000000001",
  firstTransactionId: "f0000005-0000-4000-8000-000000000001",
};

/**
 * The unsigned `x-auth-data` header every store-facing route reads.
 *
 * This IS the P0-1 vulnerability, and the contract suite documents it rather
 * than papers over it: when store sessions become signed, these snapshots are
 * what proves the replacement kept the same behaviour.
 */
export function authHeaders(over: Record<string, unknown> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-auth-data": JSON.stringify({
      store_id: STORE_ID,
      user_id: FIXTURE.managerUserId,
      user_name: "Fixture Manager",
      ...over,
    }),
  };
}

export interface ContractResult {
  status: number;
  /** Response body reduced to its shape. See the header. */
  shape: unknown;
  /** The raw body, for assertions that care about a specific value. */
  body: unknown;
}

export async function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {}
): Promise<ContractResult> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: opts.headers ?? authHeaders(),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* non-JSON is itself part of the contract */ }

  return { status: res.status, shape: shapeOf(body), body };
}

/**
 * Reduce a value to a structural description.
 *
 * Arrays collapse to a single element plus a count bucket, because a snapshot
 * that grows with the fixture row count is a snapshot that breaks whenever
 * anyone adds a fixture — and the number of rows is not the contract.
 */
export function shapeOf(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return ["<empty>"];
    // Union the shapes of the first few, so an array of mixed rows is not
    // described by whichever happened to sort first.
    const sample = value.slice(0, 3).map(shapeOf);
    const uniq = [...new Set(sample.map((s) => JSON.stringify(s)))].map((s) => JSON.parse(s));
    // ASCII marker: a non-ASCII one round-trips through the .snap file as
    // U+FFFD, which makes every snapshot look changed for no reason.
    return uniq.length === 1 ? [uniq[0], "..."] : [...uniq, "..."];
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = shapeOf((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return typeof value;
}

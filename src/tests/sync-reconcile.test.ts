import { describe, it, expect } from "vitest";
import { evaluateReconcile } from "../lib/sync/engine";
import { fetchAllProductIds } from "../lib/supabase/client";

// PostgREST's server-side row cap. An unbounded select silently returns at
// most this many rows with no error and no indication of truncation — which
// is exactly what made the original bug invisible.
const POSTGREST_MAX_ROWS = 1000;

/**
 * Minimal stand-in for the Supabase query builder used by fetchAllProductIds:
 *   .from("products").select("id").order("id").eq("store_id", id).range(f, t)
 *
 * `maxRows` emulates the server-side cap, so a caller that forgets .range()
 * (or asks for more than the cap) gets silently truncated data — the real
 * failure mode.
 */
function makeSupabaseStub(
  allIds: string[],
  opts: { maxRows?: number; failAtCall?: number } = {}
) {
  const maxRows = opts.maxRows ?? POSTGREST_MAX_ROWS;
  const state = { rangeCalls: 0 };

  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    range: (from: number, to: number) => {
      state.rangeCalls++;
      if (opts.failAtCall && state.rangeCalls === opts.failAtCall) {
        return Promise.resolve({ data: null, error: { message: "network down" } });
      }
      const requested = to - from + 1;
      const limit = Math.min(requested, maxRows);
      const page = allIds.slice(from, from + limit).map((id) => ({ id }));
      return Promise.resolve({ data: page, error: null });
    },
  };

  return { client: { from: () => builder } as any, state };
}

const makeIds = (n: number) =>
  Array.from({ length: n }, (_, i) => `p${String(i).padStart(6, "0")}`);

describe("fetchAllProductIds", () => {
  it("returns every ID for a catalog larger than the PostgREST row cap", async () => {
    const ids = makeIds(2500);
    const { client } = makeSupabaseStub(ids);

    const result = await fetchAllProductIds(client, "store-1");

    // The regression this guards: a single unpaginated select returns 1000.
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2500);
    expect(result).toEqual(ids);
  });

  it("paginates rather than relying on one large request", async () => {
    const { client, state } = makeSupabaseStub(makeIds(2500));

    await fetchAllProductIds(client, "store-1");

    // 1000 + 1000 + 500 => three ranged requests.
    expect(state.rangeCalls).toBe(3);
  });

  it("handles a catalog at exactly the page boundary", async () => {
    const ids = makeIds(2000);
    const { client } = makeSupabaseStub(ids);

    const result = await fetchAllProductIds(client, "store-1");

    expect(result!.length).toBe(2000);
  });

  it("handles small catalogs in a single request", async () => {
    const { client, state } = makeSupabaseStub(makeIds(12));

    const result = await fetchAllProductIds(client, "store-1");

    expect(result!.length).toBe(12);
    expect(state.rangeCalls).toBe(1);
  });

  it("handles an empty catalog", async () => {
    const { client } = makeSupabaseStub([]);
    expect(await fetchAllProductIds(client, "store-1")).toEqual([]);
  });

  it("returns null on error instead of a partial list", async () => {
    // Failing on the second page is the dangerous case: returning the 1000
    // IDs from page one would look like a complete catalog to the caller.
    const { client } = makeSupabaseStub(makeIds(2500), { failAtCall: 2 });

    expect(await fetchAllProductIds(client, "store-1")).toBeNull();
  });
});

describe("evaluateReconcile", () => {
  it("reconciles when the ID set is provably complete and the cache is stale", () => {
    expect(
      evaluateReconcile({ cachedCount: 2500, liveCount: 2400, fetchedIdCount: 2400 })
    ).toEqual({ reconcile: true });
  });

  it("REFUSES to delete when the fetched ID count is short of the live count", () => {
    // This is the exact original bug: 2500 products, an unpaginated select
    // returns 1000, and reconcile concludes 1500 products were deleted.
    const decision = evaluateReconcile({
      cachedCount: 2500,
      liveCount: 2500,
      fetchedIdCount: POSTGREST_MAX_ROWS,
    });

    expect(decision.reconcile).toBe(false);
  });

  it("REFUSES to delete when the live count is unknown", () => {
    expect(
      evaluateReconcile({ cachedCount: 2500, liveCount: null, fetchedIdCount: 2500 })
        .reconcile
    ).toBe(false);
  });

  it("REFUSES to delete when the ID fetch failed", () => {
    expect(
      evaluateReconcile({ cachedCount: 2500, liveCount: 2400, fetchedIdCount: null })
        .reconcile
    ).toBe(false);
  });

  it("REFUSES to delete when the catalog grew mid-fetch", () => {
    expect(
      evaluateReconcile({ cachedCount: 2500, liveCount: 2400, fetchedIdCount: 2401 })
        .reconcile
    ).toBe(false);
  });

  it("skips the ID sweep when the cache is not ahead of the server", () => {
    // Nothing can have been deleted, so there is no reason to fetch IDs.
    const decision = evaluateReconcile({
      cachedCount: 2400,
      liveCount: 2500,
      fetchedIdCount: null,
    });

    expect(decision).toEqual({
      reconcile: false,
      reason: "cache is not ahead of server",
    });
  });

  it("skips when cache and server agree exactly", () => {
    expect(
      evaluateReconcile({ cachedCount: 2500, liveCount: 2500, fetchedIdCount: null })
    ).toEqual({ reconcile: false, reason: "cache is not ahead of server" });
  });

  it("does not enter the delete/refetch thrash loop across repeated syncs", () => {
    // Regression guard for the original symptom. Simulate the loop: a 2500
    // product store where the ID fetch is truncated at 1000. Previously each
    // cycle deleted 1500 rows and the next re-pulled them, forever.
    let cachedCount = 2500;
    const liveCount = 2500;

    for (let cycle = 0; cycle < 5; cycle++) {
      const decision = evaluateReconcile({
        cachedCount,
        liveCount,
        fetchedIdCount: POSTGREST_MAX_ROWS,
      });
      if (decision.reconcile) {
        cachedCount = POSTGREST_MAX_ROWS; // what the old code would have done
      }
    }

    expect(cachedCount).toBe(2500);
  });
});

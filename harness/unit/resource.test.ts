// =============================================
// The client data primitive (src/lib/data/resource.ts)
//
// Phase 3.1. Unlike its neighbours in this folder these are not
// characterization tests of existing behaviour — this code is new — so they
// are the spec, and the ones that matter are the ones about NOT losing data:
//
//  * a failed revalidate keeps the cached value and keeps `hydrated`
//    (invariant #8's rule, applied to display data: removing things requires
//    positive evidence)
//  * `hydrated` means "this device has held an answer", never "the value is
//    non-empty" — the conflation that is audit P1-12
//  * every entry is store-scoped, so two tenants cannot share one
//  * nothing can strand a resource as permanently in-flight
//
// Each test uses a unique resource NAME, because the entry map is module-level
// by design (that is what makes two components share one fetch). Unique names
// are the isolation; there is no reset hook to forget to call.
// =============================================

import { describe, it, expect, vi } from "vitest";
import {
  clearResourceCache,
  getResourceState,
  isAwaitingFirstLoad,
  refreshResource,
  subscribeResource,
  whenResourceSettles,
  writeResource,
  type ResourceDefinition,
} from "@/lib/data/resource";

type Bag = Record<string, string[]>;

const EMPTY: string[] = [];
let counter = 0;

interface Harness {
  def: ResourceDefinition<string[]>;
  cache: Bag;
  fetches: string[];
  /** Resolve/reject the pending fetch by hand. */
  settle: (value: string[]) => void;
  fail: (message?: string) => void;
}

/**
 * A resource backed by a plain object instead of localStorage, with a fetch the
 * test drives by hand. Deliberately nothing browser-specific: the primitive is
 * pure, and a test needing a DOM would be a signal it had stopped being so.
 */
function makeResource(overrides: Partial<ResourceDefinition<string[]>> = {}): Harness {
  const cache: Bag = {};
  const fetches: string[] = [];
  let pending: { resolve: (v: string[]) => void; reject: (e: Error) => void } | null = null;

  const def: ResourceDefinition<string[]> = {
    name: `test-resource-${++counter}`,
    empty: EMPTY,
    read: (storeId) => cache[storeId] ?? EMPTY,
    has: (storeId) => Object.prototype.hasOwnProperty.call(cache, storeId),
    write: (storeId, value) => {
      cache[storeId] = value;
    },
    fetch: (storeId) => {
      fetches.push(storeId);
      return new Promise<string[]>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
    ...overrides,
  };

  return {
    def,
    cache,
    fetches,
    settle: (value) => pending?.resolve(value),
    fail: (message = "offline") => pending?.reject(new Error(message)),
  };
}

/** Let the microtask queue drain so a settled fetch has reached the store. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("cache first", () => {
  it("seeds the first read from the cache, synchronously", () => {
    const h = makeResource();
    h.cache["store-a"] = ["cheese"];

    const state = getResourceState(h.def, "store-a");

    expect(state.data).toEqual(["cheese"]);
    expect(state.hydrated).toBe(true);
    expect(state.loading).toBe(false);
    expect(h.fetches).toEqual([]);
  });

  it("a device that has never loaded is NOT hydrated, and its data is empty", () => {
    const h = makeResource();

    const state = getResourceState(h.def, "store-a");

    expect(state.data).toBe(EMPTY);
    expect(state.hydrated).toBe(false);
  });

  it("an EMPTY cached value still counts as hydrated — the key is the proof", () => {
    // This is audit P1-12 in one assertion. A shop can genuinely have no
    // recipes; that is an answer. A device that has never fetched them has no
    // answer at all, and the two must not look alike.
    const h = makeResource();
    h.cache["store-a"] = [];

    expect(getResourceState(h.def, "store-a").hydrated).toBe(true);
    expect(getResourceState(h.def, "store-b").hydrated).toBe(false);
  });

  it("degrades to empty when the cached copy cannot be read", () => {
    const h = makeResource({
      read: () => {
        throw new Error("corrupt JSON");
      },
    });

    const state = getResourceState(h.def, "store-a");

    expect(state.data).toBe(EMPTY);
    expect(state.hydrated).toBe(false);
  });

  it("returns a reference-stable snapshot until something changes", () => {
    const h = makeResource();
    expect(getResourceState(h.def, "store-a")).toBe(getResourceState(h.def, "store-a"));
  });
});

describe("a failed revalidate never empties the cache", () => {
  it("keeps the cached data AND hydrated, and records the error", async () => {
    const h = makeResource();
    h.cache["store-a"] = ["cheese"];

    const run = refreshResource(h.def, "store-a");
    h.fail("network down");
    const state = await run;

    expect(state.data).toEqual(["cheese"]);
    expect(state.hydrated).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error?.message).toBe("network down");
    expect(state.fetchedAt).toBeNull();
  });

  it("never rejects, whatever the fetch does", async () => {
    const h = makeResource();
    const run = refreshResource(h.def, "store-a");
    h.fail();
    await expect(run).resolves.toMatchObject({ hydrated: false });
  });

  it("leaves a fresh device un-hydrated rather than claiming an empty answer", async () => {
    const h = makeResource();

    const run = refreshResource(h.def, "store-a");
    h.fail();
    const state = await run;

    expect(state.hydrated).toBe(false);
    expect(state.data).toBe(EMPTY);
  });

  it("keeps the fetched value usable even when it cannot be cached", async () => {
    const h = makeResource({
      write: () => {
        throw new Error("QuotaExceededError");
      },
    });

    const run = refreshResource(h.def, "store-a");
    h.settle(["cheese"]);
    const state = await run;

    expect(state.data).toEqual(["cheese"]);
    expect(state.hydrated).toBe(true);
    expect(state.error).toBeNull();
  });
});

describe("one request per (resource, store)", () => {
  it("shares an in-flight fetch between concurrent callers", async () => {
    const h = makeResource();

    const a = refreshResource(h.def, "store-a");
    const b = refreshResource(h.def, "store-a");
    expect(h.fetches).toEqual(["store-a"]);

    h.settle(["cheese"]);
    expect(await a).toBe(await b);
  });

  it("does not share across stores — tenancy is in the key", async () => {
    const h = makeResource();

    void refreshResource(h.def, "store-a");
    void refreshResource(h.def, "store-b");

    expect(h.fetches).toEqual(["store-a", "store-b"]);
    expect(getResourceState(h.def, "store-a")).not.toBe(getResourceState(h.def, "store-b"));
  });

  it("skips a revalidate inside staleTime, and force overrides it", async () => {
    const h = makeResource({ staleTime: 60_000 });

    const first = refreshResource(h.def, "store-a");
    h.settle(["cheese"]);
    await first;
    expect(h.fetches).toHaveLength(1);

    await refreshResource(h.def, "store-a");
    expect(h.fetches).toHaveLength(1);

    void refreshResource(h.def, "store-a", { force: true });
    expect(h.fetches).toHaveLength(2);
  });

  it("NOTIFIES subscribers on a local write", () => {
    // The inventory page depends on exactly this: since Phase 3.3 `saveRecipe`
    // and `saveCombo` write through the resource and the page keeps no copy of
    // its own, so a save that did not notify would leave the editor showing the
    // recipe as it was before the edit.
    const h = makeResource();
    const listener = vi.fn();
    subscribeResource(h.def, "store-a", listener);

    writeResource(h.def, "store-a", ["cheese"]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getResourceState(h.def, "store-a").data).toEqual(["cheese"]);
  });

  it("does not extend the stale window on a local write", async () => {
    const h = makeResource({ staleTime: 60_000 });

    writeResource(h.def, "store-a", ["cheese"]);
    expect(getResourceState(h.def, "store-a").hydrated).toBe(true);
    expect(h.cache["store-a"]).toEqual(["cheese"]);

    void refreshResource(h.def, "store-a");
    expect(h.fetches).toEqual(["store-a"]);
  });

  it("a synchronous throw in fetch does not strand the resource in flight", async () => {
    const h = makeResource({
      fetch: () => {
        throw new Error("bad store id");
      },
    });

    await refreshResource(h.def, "store-a");
    // If the in-flight slot were left set, this would resolve the OLD promise
    // and the resource could never be refreshed again for the life of the tab.
    const second = refreshResource(h.def, "store-a");
    await expect(second).resolves.toMatchObject({ error: expect.any(Error) });
  });

  it("does nothing at all without a store id", async () => {
    const h = makeResource();
    const state = await refreshResource(h.def, "");
    expect(h.fetches).toEqual([]);
    expect(state.hydrated).toBe(false);
  });
});

describe("offline", () => {
  it("skips a request it knows will fail — but only with something to show", async () => {
    const h = makeResource({ isOnline: () => false });
    h.cache["store-a"] = ["cheese"];

    await refreshResource(h.def, "store-a");
    expect(h.fetches).toEqual([]);

    // Force is the escape hatch: the user asked.
    void refreshResource(h.def, "store-a", { force: true });
    expect(h.fetches).toEqual(["store-a"]);
  });

  it("a device that knows NOTHING still tries, because the heartbeat can be stale", () => {
    const h = makeResource({ isOnline: () => false });

    void refreshResource(h.def, "store-a");

    expect(h.fetches).toEqual(["store-a"]);
  });
});

describe("subscriptions", () => {
  it("notifies once per real change, and not at all for a no-op", async () => {
    const h = makeResource();
    const listener = vi.fn();
    subscribeResource(h.def, "store-a", listener);

    void refreshResource(h.def, "store-a");
    expect(listener).toHaveBeenCalledTimes(1); // loading: true

    // A second caller joining an in-flight request must not push a render
    // through everyone already watching it.
    void refreshResource(h.def, "store-a");
    expect(listener).toHaveBeenCalledTimes(1);

    h.settle(["cheese"]);
    await tick();
    expect(listener).toHaveBeenCalledTimes(2); // the result
  });

  it("stops notifying after unsubscribe", async () => {
    const h = makeResource();
    const listener = vi.fn();
    const off = subscribeResource(h.def, "store-a", listener);
    off();

    void refreshResource(h.def, "store-a");
    h.settle(["cheese"]);
    await tick();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("isAwaitingFirstLoad — the P1-12 distinction", () => {
  it("is true only when nothing is known AND an answer is coming", async () => {
    const h = makeResource();

    expect(isAwaitingFirstLoad(getResourceState(h.def, "store-a"))).toBe(false);

    const run = refreshResource(h.def, "store-a");
    expect(isAwaitingFirstLoad(getResourceState(h.def, "store-a"))).toBe(true);

    h.settle([]);
    await run;
    // An empty ANSWER is not an absence.
    expect(isAwaitingFirstLoad(getResourceState(h.def, "store-a"))).toBe(false);
  });

  it("is false once a hydrated resource is merely revalidating", async () => {
    const h = makeResource();
    h.cache["store-a"] = ["cheese"];

    void refreshResource(h.def, "store-a");
    const state = getResourceState(h.def, "store-a");

    expect(state.loading).toBe(true);
    expect(isAwaitingFirstLoad(state)).toBe(false);
  });
});

describe("whenResourceSettles", () => {
  it("resolves immediately, and fetches nothing, when the device already knows", async () => {
    const h = makeResource();
    h.cache["store-a"] = ["cheese"];

    const state = await whenResourceSettles(h.def, "store-a");

    expect(state.data).toEqual(["cheese"]);
    expect(h.fetches).toEqual([]);
  });

  it("waits for the answer on a device that has never loaded", async () => {
    const h = makeResource();

    const settled = whenResourceSettles(h.def, "store-a", { timeoutMs: 1_000 });
    h.settle(["cheese"]);

    expect((await settled).data).toEqual(["cheese"]);
  });

  it("gives up at the timeout rather than holding a scan open", async () => {
    // Invariant #10 in miniature: a hanging request must never be able to block
    // the till indefinitely. The fetch here is never settled.
    const h = makeResource();

    const state = await whenResourceSettles(h.def, "store-a", { timeoutMs: 20 });

    expect(state.hydrated).toBe(false);
    expect(state.data).toBe(EMPTY);
  });

  it("joins an in-flight load rather than starting a second one", async () => {
    const h = makeResource();

    void refreshResource(h.def, "store-a");
    const settled = whenResourceSettles(h.def, "store-a", { timeoutMs: 1_000 });
    expect(h.fetches).toEqual(["store-a"]);

    h.settle(["cheese"]);
    expect((await settled).data).toEqual(["cheese"]);
  });
});

describe("clearResourceCache", () => {
  it("resets the state and keeps existing subscribers live", async () => {
    const h = makeResource();
    h.cache["store-a"] = ["cheese"];
    const listener = vi.fn();
    subscribeResource(h.def, "store-a", listener);

    expect(getResourceState(h.def, "store-a").hydrated).toBe(true);

    delete h.cache["store-a"]; // what logout does to the persisted copy
    clearResourceCache();

    expect(listener).toHaveBeenCalled();
    expect(getResourceState(h.def, "store-a").hydrated).toBe(false);
    expect(getResourceState(h.def, "store-a").data).toBe(EMPTY);

    // Still watching: a subscriber orphaned by the clear would go deaf until
    // its component remounted, which a logout does not guarantee.
    listener.mockClear();
    void refreshResource(h.def, "store-a");
    expect(listener).toHaveBeenCalled();
  });

  it("clears only the store it is given", () => {
    const h = makeResource();
    h.cache["store-a"] = ["cheese"];
    h.cache["store-b"] = ["pickles"];
    subscribeResource(h.def, "store-a", () => {});
    subscribeResource(h.def, "store-b", () => {});

    clearResourceCache("store-a");

    expect(getResourceState(h.def, "store-a").hydrated).toBe(false);
    expect(getResourceState(h.def, "store-b").data).toEqual(["pickles"]);
  });
});

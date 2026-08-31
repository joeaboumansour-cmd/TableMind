// =============================================
// The client data primitive — cache first, network second, once
// =============================================
// TanStack was removed and nothing replaced it, so every screen hand-rolls
// "read the cache, paint it, then revalidate" inside a `useEffect`. Fifteen
// copies of the same six lines is where the duplicate fetches, the double
// renders and the boot burst come from — and where audit **P1-12** hides: an
// absent cache and an absent record look identical to every one of those
// copies, so a menu item scanned before the recipes land is sold as a plain
// line, with no ticket for the kitchen and the wrong stock deducted.
//
// This is that pattern, written once, with the states it was missing:
//
//   * **Cache first.** `read()` is synchronous, so the first frame is right.
//   * **Store-scoped keys.** Tenancy is in the entry key, structurally — there
//     is no way to ask for a resource without saying whose.
//   * **In-flight sharing.** One request per (resource, store), however many
//     components ask, and one notify per real change rather than one per
//     subscriber.
//   * **Offline-aware.** A failed revalidate KEEPS the cached value. Removing
//     things requires positive evidence — the same rule as
//     `evaluateReconcile()`.
//   * **"We don't know yet" is a state.** `hydrated` says whether this device
//     has ever held an answer; `loading` says whether one is coming. The pair
//     is what P1-12 needs and what no `useEffect` copy could express.
//
// This file is PURE: no React, no fetch, no browser API beyond a `window`
// existence check, and no imports at all. Everything environment-specific
// arrives through the `ResourceDefinition` the caller supplies. That is what
// makes it testable in the harness's node environment, and it is deliberate —
// keep it that way.
// =============================================

/**
 * What a caller sees. Always all five fields; there is no undefined state.
 *
 * The distinction that matters, and the one the hand-rolled copies could not
 * make:
 *
 * | `hydrated` | `loading` | meaning |
 * |---|---|---|
 * | false | false | **Nothing known and nothing coming.** Offline on a fresh device, or the fetch failed. `data` is the empty value. |
 * | false | true  | **Nothing known, an answer is on its way.** The only state in which a caller should consider WAITING — see `whenResourceSettles`. |
 * | true  | false | Settled. `data` is the last good value. |
 * | true  | true  | Settled, revalidating behind. `data` stays usable throughout. |
 */
export interface ResourceState<T> {
  /** Always renderable. The cached value, the fetched value, or `empty`. */
  readonly data: T;
  /**
   * Has this store's value EVER been written to this device?
   *
   * Deliberately NOT "is `data` non-empty". A shop can genuinely have no
   * recipes and no categories; a device that has never loaded them has no
   * answer at all. Conflating those two is audit P1-12.
   */
  readonly hydrated: boolean;
  /** A revalidation is in flight right now. */
  readonly loading: boolean;
  /** The last attempt failed. `data` is untouched — still the last good value. */
  readonly error: Error | null;
  /** Epoch ms of the last SUCCESSFUL fetch **in this tab**. Not persisted. */
  readonly fetchedAt: number | null;
}

export interface ResourceDefinition<T> {
  /** Stable name. Forms half of the entry key; the store id is the other half. */
  readonly name: string;

  /**
   * The value before anything is known. Must be a STABLE reference — it is
   * handed out as `data` and compared by identity.
   */
  readonly empty: T;

  /** The cached value, synchronously. Must not throw; a throw is treated as `empty`. */
  read(storeId: string): T;

  /**
   * Has this store's value ever been written to this device? The cache KEY's
   * existence, not the value's emptiness.
   */
  has(storeId: string): boolean;

  /**
   * The network read. **MUST reject on failure** — including on a partial or
   * malformed payload.
   *
   * This inversion is what makes the primitive worth having. The loaders this
   * replaced (`refreshCategories`, `refreshRecipes`, `refreshCombos`) each
   * caught their own errors and RESOLVED with the cached copy, so a caller's
   * `.then()` said nothing about whether the fetch worked and a `.catch()`
   * beside it was dead code. That is precisely the trap the first P1-12
   * attempt fell into. Here the swallow happens in ONE place, below, where it
   * can also record `error` and leave `hydrated` alone.
   */
  fetch(storeId: string): Promise<T>;

  /** Persist a fetched value. Must not throw — a full disk cannot break a sale. */
  write(storeId: string, value: T): void;

  /**
   * Skip a revalidation this many ms after the last successful one.
   *
   * In-memory and per-tab, so a page load always revalidates. What it collapses
   * is the *cross-screen* duplicate: /pos and /pos/products both refresh
   * categories and recipes on mount, so walking between them costs four
   * requests for data that changes a few times a week. Default 0 — always
   * revalidate — so a resource that wants this has to say so.
   */
  readonly staleTime?: number;

  /**
   * Optional connectivity probe. Supplied by the resource rather than imported
   * here, so this file stays dependency-free and the offline path stays
   * testable.
   *
   * Only ever used to skip a request we already have an answer for; a device
   * that knows nothing always tries, because the heartbeat can be stale and
   * trying is the only chance it has.
   */
  isOnline?(): boolean;
}

interface Entry<T> {
  /** Kept so `clearResourceCache` can reset to the right empty value. */
  readonly def: ResourceDefinition<T>;
  state: ResourceState<T>;
  listeners: Set<() => void>;
  inFlight: Promise<ResourceState<T>> | null;
}

/**
 * Every entry, keyed `name:storeId`.
 *
 * **Browser only.** Client components are still executed on the server for SSR,
 * and a module-level Map there is shared by every request on the instance.
 * Nothing below ever creates or mutates an entry without `isBrowser()`, and the
 * server path hands back a frozen empty state instead.
 */
const entries = new Map<string, Entry<unknown>>();

/** One frozen empty state per definition, so SSR snapshots are reference-stable. */
const emptyStates = new WeakMap<ResourceDefinition<unknown>, ResourceState<unknown>>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function keyFor(name: string, storeId: string): string {
  return `${name}:${storeId}`;
}

/**
 * The state to hand back when there is nothing to hand back: no browser, or no
 * store id. Cached per definition because `useSyncExternalStore` requires a
 * snapshot getter that does not allocate.
 */
function emptyStateFor<T>(def: ResourceDefinition<T>): ResourceState<T> {
  const cached = emptyStates.get(def as ResourceDefinition<unknown>);
  if (cached) return cached as ResourceState<T>;

  const fresh: ResourceState<T> = Object.freeze({
    data: def.empty,
    hydrated: false,
    loading: false,
    error: null,
    fetchedAt: null,
  });
  emptyStates.set(def as ResourceDefinition<unknown>, fresh as ResourceState<unknown>);
  return fresh;
}

function ensureEntry<T>(def: ResourceDefinition<T>, storeId: string): Entry<T> {
  const key = keyFor(def.name, storeId);
  const existing = entries.get(key);
  if (existing) return existing as Entry<T>;

  // Seeded from the cache, so the very first `getResourceState` — which is the
  // first render — already has whatever this device knows.
  let data = def.empty;
  let hydrated = false;
  try {
    data = def.read(storeId);
    hydrated = def.has(storeId);
  } catch {
    // A cache we cannot read is a cache we do not have. Degrade to empty, never
    // to a broken screen.
  }

  const entry: Entry<T> = {
    def,
    state: { data, hydrated, loading: false, error: null, fetchedAt: null },
    listeners: new Set(),
    inFlight: null,
  };
  entries.set(key, entry as Entry<unknown>);
  return entry;
}

function sameState<T>(a: ResourceState<T>, b: ResourceState<T>): boolean {
  return (
    a.data === b.data &&
    a.hydrated === b.hydrated &&
    a.loading === b.loading &&
    a.error === b.error &&
    a.fetchedAt === b.fetchedAt
  );
}

/**
 * Replace the state and notify — but only when something actually changed.
 *
 * The no-op check is the "one render, not one per subscriber" half of the
 * design: a second component asking for a resource that is already loading must
 * not push a render through every other component watching it.
 */
function commit<T>(entry: Entry<T>, patch: Partial<ResourceState<T>>): ResourceState<T> {
  const next: ResourceState<T> = { ...entry.state, ...patch };
  if (sameState(entry.state, next)) return entry.state;

  entry.state = next;
  // Copy first: a listener may unsubscribe (React does, on unmount) while we
  // are iterating.
  for (const listener of [...entry.listeners]) listener();
  return next;
}

/** The current state. Reference-stable until something really changes. */
export function getResourceState<T>(
  def: ResourceDefinition<T>,
  storeId: string | null | undefined
): ResourceState<T> {
  if (!isBrowser() || !storeId) return emptyStateFor(def);
  return ensureEntry(def, storeId).state;
}

/** Watch one (resource, store). Returns the unsubscribe. */
export function subscribeResource<T>(
  def: ResourceDefinition<T>,
  storeId: string | null | undefined,
  listener: () => void
): () => void {
  if (!isBrowser() || !storeId) return () => {};

  const entry = ensureEntry(def, storeId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

export interface RefreshOptions {
  /** Ignore `staleTime` and the offline skip. For "the user just saved something". */
  readonly force?: boolean;
}

/**
 * Revalidate. Never rejects, and never empties `data`.
 *
 * Resolves with the resulting STATE rather than the value, so a caller can see
 * `error` without having to know that `fetch` is the only thing that rejects.
 * Returning bare data is how the current loaders hide their failures.
 */
export function refreshResource<T>(
  def: ResourceDefinition<T>,
  storeId: string | null | undefined,
  options: RefreshOptions = {}
): Promise<ResourceState<T>> {
  if (!isBrowser() || !storeId) return Promise.resolve(emptyStateFor(def));

  const entry = ensureEntry(def, storeId);

  // One request per (resource, store). Two components mounting in the same
  // frame share this promise and the single render that follows it.
  if (entry.inFlight) return entry.inFlight;

  if (!options.force) {
    const { fetchedAt, hydrated } = entry.state;

    if (fetchedAt !== null && Date.now() - fetchedAt < (def.staleTime ?? 0)) {
      return Promise.resolve(entry.state);
    }

    // Known offline WITH something to show: the request would fail, the data
    // would not change, and the cost is a rejected fetch and a console line on
    // every screen mount for as long as the outage lasts. A device that knows
    // NOTHING still tries — see `isOnline` above.
    if (hydrated && def.isOnline && !def.isOnline()) {
      return Promise.resolve(entry.state);
    }
  }

  commit(entry, { loading: true });

  const run = attempt(def, storeId, entry);
  entry.inFlight = run;
  // `.then` is always a microtask, so this cannot clear the slot before the
  // line above sets it — which a synchronous throw inside `fetch` otherwise
  // would, stranding the resource as permanently "in flight".
  void run.then(() => {
    if (entry.inFlight === run) entry.inFlight = null;
  });

  return run;
}

async function attempt<T>(
  def: ResourceDefinition<T>,
  storeId: string,
  entry: Entry<T>
): Promise<ResourceState<T>> {
  try {
    const value = await def.fetch(storeId);
    try {
      def.write(storeId, value);
    } catch {
      // Quota, private mode, a full disk. The value is still good for this
      // session; only the next cold start loses it.
    }
    return commit(entry, {
      data: value,
      hydrated: true,
      loading: false,
      error: null,
      fetchedAt: Date.now(),
    });
  } catch (cause) {
    // Offline, a 500, a truncated payload. Keep everything: `data` stays the
    // last good value and `hydrated` stays whatever it was, because a failed
    // fetch is not evidence that the cached copy is wrong.
    const error = cause instanceof Error ? cause : new Error(String(cause));
    return commit(entry, { loading: false, error });
  }
}

/**
 * Adopt a value the caller already has — a save that returned the new rows, a
 * local edit. Writes the cache and notifies, exactly as a fetch would.
 *
 * Deliberately does NOT touch `fetchedAt`: a local write is not a revalidation,
 * and it must not extend the stale window past the next mount.
 */
export function writeResource<T>(
  def: ResourceDefinition<T>,
  storeId: string | null | undefined,
  value: T
): void {
  if (!isBrowser() || !storeId) return;

  const entry = ensureEntry(def, storeId);
  try {
    def.write(storeId, value);
  } catch {
    /* see attempt() — an uncacheable value is still a usable one */
  }
  commit(entry, { data: value, hydrated: true, error: null });
}

export interface SettleOptions extends RefreshOptions {
  /**
   * Give up waiting after this long and resolve with whatever is known.
   *
   * There is always a cap, and it is short. A till that pauses a scan
   * indefinitely because a request is hanging is a worse failure than the one
   * this exists to prevent — invariant #10: a sale is never blocked.
   */
  readonly timeoutMs?: number;
}

/** Long enough for a healthy round trip, short enough not to be felt at a counter. */
const DEFAULT_SETTLE_MS = 1_200;

/**
 * Resolve once this resource has an ANSWER — cached, fetched, or failed.
 *
 * This is the affordance audit **P1-12** needs. The till scans a barcode and
 * must decide whether the product is a menu item; on a device that has never
 * loaded the recipes, "no recipe" is not an answer, it is an absence. The fix
 * is to HOLD the line for at most a moment and then add it properly — not to
 * refuse the scan (tried, reverted: without recipes the till cannot tell a
 * sandwich from a bottle of water, so the guard refused EVERY scan) and not to
 * guess.
 *
 * Returns immediately when the device already knows — which is every scan on a
 * warm till, so the common path costs nothing.
 */
export function whenResourceSettles<T>(
  def: ResourceDefinition<T>,
  storeId: string | null | undefined,
  options: SettleOptions = {}
): Promise<ResourceState<T>> {
  const state = getResourceState(def, storeId);
  if (!isBrowser() || !storeId || state.hydrated) return Promise.resolve(state);

  const run = refreshResource(def, storeId, options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLE_MS;

  return new Promise<ResourceState<T>>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Read the state fresh rather than trusting the resolved one: the timeout
      // path has no state of its own, and by then a concurrent refresh may have
      // landed.
      resolve(getResourceState(def, storeId));
    };
    const timer = setTimeout(finish, timeoutMs);
    void run.then(finish);
  });
}

/**
 * Nothing known, and an answer is coming.
 *
 * The only state in which waiting is the right move. Named rather than spelled
 * out at each call site because `!hydrated && loading` reads like a detail and
 * is in fact the whole P1-12 distinction.
 */
export function isAwaitingFirstLoad(state: ResourceState<unknown>): boolean {
  return !state.hydrated && state.loading;
}

/**
 * Drop in-memory entries — all of them, or one store's.
 *
 * Called on logout beside `clearUserFromStorage()`. The persisted caches are
 * cleared there by key prefix; these are the same data held in memory, and a
 * component that never remounts would otherwise keep painting the last
 * person's. Entry keys are store-scoped, so this is belt-and-braces rather than
 * the only thing standing between two tenants — but the belt is cheap.
 */
export function clearResourceCache(storeId?: string): void {
  const suffix = storeId ? `:${storeId}` : null;

  for (const [key, entry] of [...entries.entries()]) {
    if (suffix && !key.endsWith(suffix)) continue;

    // RESET IN PLACE, do not delete. `subscribeResource` closes over the entry
    // object, so dropping it from the map would leave every mounted component
    // watching an orphan that nothing ever notifies again — deaf until it
    // remounts. React re-subscribes only when the subscribe function's identity
    // changes, which a logout does not guarantee.
    entry.inFlight = null;
    commit(entry, {
      data: entry.def.empty,
      hydrated: false,
      loading: false,
      error: null,
      fetchedAt: null,
    });

    // Nothing is watching, so there is no orphan to create and the entry is
    // just memory. Drop it so a long-lived tab does not accumulate one per
    // store it has ever seen.
    if (entry.listeners.size === 0) entries.delete(key);
  }
}

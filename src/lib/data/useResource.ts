"use client";

// =============================================
// useResource — the React binding for src/lib/data/resource.ts
// =============================================
// Everything interesting lives in `resource.ts`, which is pure and has no
// imports. This file is only the wiring: `useSyncExternalStore` for the
// subscription, one effect for the revalidate-on-mount.
//
// The split is on purpose. The store is where the money-adjacent decisions are
// (keep the cache on failure, one request per store, "we don't know yet" is a
// state), and those are testable in the harness's node environment precisely
// because React is not in the way.
// =============================================

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getResourceState,
  refreshResource,
  subscribeResource,
  type RefreshOptions,
  type ResourceDefinition,
  type ResourceState,
} from "./resource";

export interface UseResourceOptions {
  /**
   * Fetch on mount. Default true.
   *
   * `false` still returns the CACHED value — it suppresses the network, not the
   * data. That is what /pos needs for recipes and combos: the local reads are
   * unconditional and free, but the requests are gated on the `menu_items`
   * feature flag, because a plain retail store spent three round trips of its
   * cold start fetching data it has no screen for.
   */
  readonly enabled?: boolean;
}

export interface UseResourceResult<T> extends ResourceState<T> {
  /** Revalidate now. `{ force: true }` ignores `staleTime` and the offline skip. */
  refresh: (options?: RefreshOptions) => Promise<ResourceState<T>>;
}

/**
 * Subscribe to one store-scoped resource.
 *
 * Two components calling this with the same definition and store id share one
 * request and one state object, so they re-render together and exactly once per
 * real change. That is the duplicate-fetch fix: it is structural, not a rule
 * someone has to remember.
 *
 * `def` must be a module-level constant. It is the subscription's identity, so
 * a definition built inside a component would resubscribe on every render.
 */
export function useResource<T>(
  def: ResourceDefinition<T>,
  storeId: string | null | undefined,
  options: UseResourceOptions = {}
): UseResourceResult<T> {
  const { enabled = true } = options;

  const subscribe = useCallback(
    (listener: () => void) => subscribeResource(def, storeId, listener),
    [def, storeId]
  );

  const snapshot = useCallback(() => getResourceState(def, storeId), [def, storeId]);

  // The server snapshot is the same getter: `getResourceState` returns a frozen
  // empty state when there is no `window`, and never touches the entry map, so
  // SSR cannot leak one request's tenant into another's.
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!enabled || !storeId) return;
    void refreshResource(def, storeId);
  }, [def, storeId, enabled]);

  const refresh = useCallback(
    (opts?: RefreshOptions) => refreshResource(def, storeId, opts),
    [def, storeId]
  );

  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}

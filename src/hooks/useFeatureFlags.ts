"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { mergeFeaturesWithDefaults } from "@/lib/features";
import { connectivity } from "@/lib/connectivity";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";

interface FeatureFlagsState {
  flags: Record<string, boolean>;
  storeType: string;
  isLoading: boolean;
  flagsResolved: boolean;
}

interface FeatureFlagsData {
  flags: Record<string, boolean>;
  storeType: string;
}

/**
 * In-flight DB reads, keyed by store.
 *
 * Every component that calls useFeatureFlags() gets its own instance, and there
 * are at least two live on the inventory route (BottomTabBar, plus the
 * product_discount gate on the page itself). Each was issuing its own request
 * to the same endpoint and resolving on its own tick, so the UI settled twice.
 */
const inFlightByStore = new Map<string, Promise<FeatureFlagsData | null>>();

function sameFlags(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/**
 * The flags to assume before the database answers.
 *
 * MUST agree with what the API produces for a store that has never had its
 * features set, which is `mergeFeaturesWithDefaults({})` — the route returns
 * `data?.features || {}`. It used to use FEATURE_PRESETS.general instead, whose
 * product_discount is false while FEATURES.product_discount.default is true.
 * The two disagreed, so on those stores the flag flipped false → true a second
 * or two after mount and a guarded subtree appeared underneath the user.
 * FEATURE_PRESETS stays as it is: it is for provisioning a new store from the
 * admin screen, not for guessing at an existing one.
 */
function optimisticDefaults(): Record<string, boolean> {
  return mergeFeaturesWithDefaults({});
}

/**
 * Hook to read and check store-level feature flags.
 *
 * Loads flags from localStorage first (instant, offline-capable),
 * then syncs from the database in the background.
 *
 * Usage:
 *   const { isEnabled, isDisabled } = useFeatureFlags();
 *   if (isEnabled('product_discount')) { ... }
 */
export function useFeatureFlags(): {
  isEnabled: (featureKey: string) => boolean;
  isDisabled: (featureKey: string) => boolean;
  flags: Record<string, boolean>;
  storeType: string;
  isLoading: boolean;
  /**
   * Are these flags an ANSWER, or a guess?
   *
   * False means they are `optimisticDefaults()` — nothing has yet told this
   * device what this store has switched on. `isLoading` deliberately does NOT
   * say this: it goes false the moment there is something usable to render,
   * which is the right behaviour for a guard that must not spin forever on an
   * offline device, and the wrong signal for anything that must not act on a
   * guess.
   *
   * The distinction matters wherever a `false` flag CHANGES WHAT A CUSTOMER IS
   * SOLD rather than merely hiding a screen. `menu_items` is the case that
   * found this: on a first-ever launch it reads false for a few hundred ms, and
   * a sandwich scanned in that window is rung up as a plain line — no modifier
   * sheet, no kitchen ticket, and the menu item's own meaningless stock
   * decremented instead of its ingredients. That is audit P1-12's failure
   * arriving one layer above the recipes.
   *
   * Same rule as `evaluateReconcile()` and `hydrated` in the data layer: an
   * absent answer is not a negative answer.
   */
  flagsResolved: boolean;
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const [state, setState] = useState<FeatureFlagsState>({
    flags: {},
    storeType: "general",
    isLoading: true,
    flagsResolved: false,
  });

  const storeId = user?.storeId;

  // Load from localStorage (offline-first)
  const loadFromCache = useCallback((): FeatureFlagsData | null => {
    if (!storeId) return null;

    try {
      const cached = localStorage.getItem(`store_features_${storeId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          flags: parsed.flags || {},
          storeType: parsed.storeType || "general",
        };
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }, [storeId]);

  // Load from database (online sync), deduped across hook instances
  const loadFromDb = useCallback(async (): Promise<FeatureFlagsData | null> => {
    if (!storeId || !connectivity.isOnline) return null;

    const existing = inFlightByStore.get(storeId);
    if (existing) return existing;

    const request = (async (): Promise<FeatureFlagsData | null> => {
      try {
        // GET is open to the ADMIN console or to a store reading its OWN
        // flags, so the till has to identify itself (audit P0-2). Without this
        // header the route answers 401 and every flag silently falls back to
        // its default -- which reads as the menu, cash page and kitchen board
        // simply not existing.
        const response = await fetch(`/api/admin/stores/features?store_id=${storeId}`, {
          headers: buildAuthHeaders(),
        });
        if (!response.ok) return null;

        const data = await response.json();
        const flags = mergeFeaturesWithDefaults(data.features);
        const storeType = data.store_type || "general";

        // Cache to localStorage
        localStorage.setItem(
          `store_features_${storeId}`,
          JSON.stringify({ flags, storeType })
        );

        return { flags, storeType };
      } catch {
        return null;
      } finally {
        inFlightByStore.delete(storeId);
      }
    })();

    inFlightByStore.set(storeId, request);
    return request;
  }, [storeId]);

  // Initialize
  useEffect(() => {
    if (!storeId) {
      // "No store yet" is NOT an answer — it is the absence of one, and it must
      // not be reported as finished loading with nothing enabled.
      //
      // On a cold direct load of a guarded route (opening /pos/cash from a
      // bookmark, a refresh, or the PWA icon) AuthContext has not hydrated the
      // user from localStorage yet, so storeId is briefly undefined. This used
      // to set isLoading:false with flags:{}, which reads as "loading finished,
      // nothing is enabled". The route guard runs on the very next render —
      // user is now present, flagsLoading is already false, flags are still
      // empty — and bounces the cashier to /pos claiming the feature is not
      // enabled for a store that has it switched on. Reaching the same page by
      // clicking through worked, because the flags were loaded by then.
      //
      // Same rule as evaluateReconcile(): never act destructively on unknown.
      // A guard may only deny once the flags have actually been resolved.
      setState((prev) =>
        prev.isLoading && Object.keys(prev.flags).length === 0
          ? prev
          : { flags: {}, storeType: "general", isLoading: true, flagsResolved: false }
      );
      return;
    }

    let active = true;

    // 1. Resolve something usable immediately — cache if we have one, otherwise
    //    the same defaults the API would produce for an unconfigured store.
    const cached = loadFromCache();
    const initial: FeatureFlagsData = cached
      ? { flags: mergeFeaturesWithDefaults(cached.flags), storeType: cached.storeType }
      : { flags: optimisticDefaults(), storeType: "general" };
    // A cache is an ANSWER; the optimistic defaults are a guess. See
    // `flagsResolved` on the return type for why the difference is load-bearing.
    setState({ ...initial, isLoading: false, flagsResolved: cached !== null });

    // 2. Sync from database in background.
    loadFromDb().then((dbData) => {
      if (!active || !dbData) return;
      setState((prev) => {
        // Confirming what we already show costs a full re-render of everything
        // downstream — including the tab bar, whose height feeds the inventory
        // list's virtualiser. Only update when something actually differs.
        if (
          prev.flagsResolved &&
          prev.storeType === dbData.storeType &&
          sameFlags(prev.flags, dbData.flags)
        ) {
          return prev;
        }
        // Even when the values match, `flagsResolved` may not have been true
        // yet — the guess happened to be right, which is not the same as
        // having been told.
        return { ...prev, flags: dbData.flags, storeType: dbData.storeType, flagsResolved: true };
      });
    });

    return () => {
      active = false;
    };
  }, [storeId, loadFromCache, loadFromDb]);

  const isEnabled = useCallback(
    (featureKey: string): boolean => {
      return state.flags[featureKey] === true;
    },
    [state.flags]
  );

  const isDisabled = useCallback(
    (featureKey: string): boolean => !isEnabled(featureKey),
    [isEnabled]
  );

  const refresh = useCallback(async () => {
    const dbData = await loadFromDb();
    if (dbData) {
      setState({
        flags: dbData.flags,
        storeType: dbData.storeType,
        isLoading: false,
        flagsResolved: true,
      });
    }
  }, [loadFromDb]);

  return useMemo(
    () => ({
      isEnabled,
      isDisabled,
      flags: state.flags,
      storeType: state.storeType,
      isLoading: state.isLoading,
      flagsResolved: state.flagsResolved,
      refresh,
    }),
    [
      isEnabled,
      isDisabled,
      state.flags,
      state.storeType,
      state.isLoading,
      state.flagsResolved,
      refresh,
    ]
  );
}

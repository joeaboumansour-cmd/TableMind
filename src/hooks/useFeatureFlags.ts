"use client";

import { useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { mergeFeaturesWithDefaults } from "@/lib/features";
import { connectivity } from "@/lib/connectivity";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { useResource } from "@/lib/data/useResource";
import type { ResourceDefinition } from "@/lib/data/resource";

interface FeatureFlagsData {
  flags: Record<string, boolean>;
  storeType: string;
}

function cacheKey(storeId: string): string {
  return `store_features_${storeId}`;
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

/** A guess, and a stable reference — see ResourceDefinition.empty. */
const NO_FLAGS: FeatureFlagsData = { flags: {}, storeType: "general" };

function sameFlags(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const keys = Object.keys(b);
  if (Object.keys(a).length !== keys.length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/**
 * The feature-flags resource.
 *
 * This was the last hand-rolled cache-then-revalidate on the client, and the
 * most expensive one: `useFeatureFlags` is mounted by around ten components and
 * had no stale window, so **every screen mount re-fetched the flags** — three
 * times across a /pos → History → /pos walk.
 *
 * `equals` is not an optimisation here, it is the behaviour the hand-rolled
 * version already had and could not afford to lose: confirming flags that have
 * not changed re-renders the tab bar, whose height feeds the inventory list's
 * virtualiser.
 */
const flagsResource: ResourceDefinition<FeatureFlagsData> = {
  name: "features",
  empty: NO_FLAGS,
  staleTime: 60_000,
  isOnline: () => connectivity.isOnline,

  has: (storeId) => {
    try {
      return localStorage.getItem(cacheKey(storeId)) !== null;
    } catch {
      return false;
    }
  },

  read: (storeId) => {
    try {
      const raw = localStorage.getItem(cacheKey(storeId));
      if (!raw) return NO_FLAGS;
      const parsed = JSON.parse(raw);
      return {
        flags: mergeFeaturesWithDefaults(parsed.flags || {}),
        storeType: parsed.storeType || "general",
      };
    } catch {
      return NO_FLAGS;
    }
  },

  write: (storeId, value) => {
    try {
      localStorage.setItem(cacheKey(storeId), JSON.stringify(value));
    } catch {
      /* quota or private mode — the flags still work for this session */
    }
  },

  equals: (a, b) => a.storeType === b.storeType && sameFlags(a.flags, b.flags),

  async fetch(storeId) {
    // GET is open to the ADMIN console or to a store reading its OWN flags, so
    // the till has to identify itself (audit P0-2). Without this header the
    // route answers 401 and every flag silently falls back to its default —
    // which reads as the menu, cash page and kitchen board simply not existing.
    const response = await fetch(`/api/admin/stores/features?store_id=${storeId}`, {
      headers: buildAuthHeaders(),
    });
    if (!response.ok) throw new Error(`API error ${response.status}`);

    const data = await response.json();
    return {
      flags: mergeFeaturesWithDefaults(data.features),
      storeType: data.store_type || "general",
    };
  },
};

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
  const storeId = user?.storeId;

  const { data, hydrated, refresh } = useResource(flagsResource, storeId);

  /**
   * "No store yet" is NOT an answer — it is the absence of one, and it must not
   * be reported as finished loading with nothing enabled.
   *
   * On a cold direct load of a guarded route (opening /pos/cash from a
   * bookmark, a refresh, or the PWA icon) AuthContext has not hydrated the user
   * from localStorage yet, so storeId is briefly undefined. This used to report
   * isLoading:false with flags:{}, which reads as "loading finished, nothing is
   * enabled". The route guard runs on the very next render — user is now
   * present, flagsLoading is already false, flags still empty — and bounces the
   * cashier to /pos claiming the feature is not enabled for a store that has it
   * switched on. Reaching the same page by clicking through worked, because the
   * flags were loaded by then.
   *
   * Same rule as evaluateReconcile(): never act destructively on unknown.
   */
  const isLoading = !storeId;

  /**
   * A cache or a DB answer is an ANSWER; anything else is a guess.
   *
   * This is exactly `hydrated` from the data layer — "has this device ever been
   * told" — which is the same distinction, arrived at from the same direction.
   */
  const flagsResolved = !!storeId && hydrated;

  /**
   * With no store, nothing is enabled and nothing claims to be resolved. With a
   * store but no answer yet, the OPTIMISTIC DEFAULTS stand in, because that is
   * what the API produces for a store whose features have never been set — a
   * guess that is usually right, marked as a guess.
   */
  const flags = useMemo(() => {
    if (!storeId) return NO_FLAGS.flags;
    return hydrated ? data.flags : optimisticDefaults();
  }, [storeId, hydrated, data]);

  const storeType = storeId && hydrated ? data.storeType : "general";

  const isEnabled = useCallback(
    (featureKey: string): boolean => flags[featureKey] === true,
    [flags]
  );

  const isDisabled = useCallback(
    (featureKey: string): boolean => !isEnabled(featureKey),
    [isEnabled]
  );

  /** Re-read from the server, ignoring the stale window. */
  const refreshFlags = useCallback(async () => {
    await refresh({ force: true });
  }, [refresh]);

  return useMemo(
    () => ({
      isEnabled,
      isDisabled,
      flags,
      storeType,
      isLoading,
      flagsResolved,
      refresh: refreshFlags,
    }),
    [isEnabled, isDisabled, flags, storeType, isLoading, flagsResolved, refreshFlags]
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { getDefaultFeaturesForPreset, mergeFeaturesWithDefaults } from "@/lib/features";

interface FeatureFlagsState {
  flags: Record<string, boolean>;
  storeType: string;
  isLoading: boolean;
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
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const [state, setState] = useState<FeatureFlagsState>({
    flags: {},
    storeType: "general",
    isLoading: true,
  });

  const storeId = user?.storeId;

  // Load from localStorage (offline-first)
  const loadFromCache = useCallback(() => {
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

  // Load from database (online sync)
  const loadFromDb = useCallback(async () => {
    if (!storeId || !navigator.onLine) return null;

    try {
      const response = await fetch(`/api/admin/stores/features?store_id=${storeId}`);
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
    }
  }, [storeId]);

  // Initialize
  useEffect(() => {
    if (!storeId) {
      setState({ flags: {}, storeType: "general", isLoading: false });
      return;
    }

    // 1. Load from cache immediately
    const cached = loadFromCache();
    if (cached) {
      const merged = mergeFeaturesWithDefaults(cached.flags);
      setState({ flags: merged, storeType: cached.storeType, isLoading: false });
    } else {
      // 2. No cache — use preset defaults
      const defaults = getDefaultFeaturesForPreset("general");
      const merged = mergeFeaturesWithDefaults(defaults);
      setState({ flags: merged, storeType: "general", isLoading: false });
    }

    // 3. Sync from database in background
    loadFromDb().then((dbData) => {
      if (dbData) {
        setState((prev) => ({
          ...prev,
          flags: dbData.flags,
          storeType: dbData.storeType,
        }));
      }
    });
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
      setState({ flags: dbData.flags, storeType: dbData.storeType, isLoading: false });
    }
  }, [loadFromDb]);

  return {
    isEnabled,
    isDisabled,
    flags: state.flags,
    storeType: state.storeType,
    isLoading: state.isLoading,
    refresh,
  };
}
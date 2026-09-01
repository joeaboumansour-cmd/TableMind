"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { mergeFeaturesWithDefaults } from "@/lib/features";
import {
  logActivity,
  setActivityLoggingEnabled,
  invalidateActivityIdentity,
} from "@/lib/activity/logger";
import { startDomTracking, stopDomTracking } from "@/lib/activity/domTracker";
import { logPerfRouteArrival } from "@/lib/activity/perf";

/** How often the kill switch is re-read, so an admin toggle takes effect without a reload. */
const FLAG_POLL_MS = 60_000;

/**
 * Mounts the activity trail.
 *
 * Renders nothing. Lives inside Providers, under AuthProvider, so it can see
 * who is signed in.
 *
 * The feature flag is read straight from the localStorage cache that
 * useFeatureFlags maintains, rather than by calling the hook. Calling it would
 * pull `connectivity` into the bundle of every route in the app including the
 * admin console, and connectivity starts a 15-second heartbeat the moment it is
 * imported — the admin pages have no business polling /api/health.
 *
 * Note: the whole /admin tree is excluded, which also leaves
 * /admin/transactions (a store-facing retention settings page that happens to
 * live under that path) uninstrumented. That is a known, small gap.
 */
export default function ActivityTracker() {
  const { user } = useAuth();
  const pathname = usePathname();

  const storeId = user?.storeId;
  const isAdminRoute = pathname?.startsWith("/admin") ?? false;

  // --- enable / disable ------------------------------------------------------
  // The effect re-runs whenever either input changes, so the interval below can
  // simply close over them — no refs needed.
  useEffect(() => {
    function applyFlag() {
      if (!storeId || isAdminRoute) {
        setActivityLoggingEnabled(false);
        stopDomTracking();
        return;
      }

      let stored: Record<string, boolean> | null = null;
      try {
        const raw = localStorage.getItem(`store_features_${storeId}`);
        if (raw) stored = JSON.parse(raw)?.flags ?? null;
      } catch {
        // Unreadable cache — fall through to defaults, same as useFeatureFlags.
      }

      const enabled = mergeFeaturesWithDefaults(stored).activity_logging === true;
      setActivityLoggingEnabled(enabled);
      if (enabled) startDomTracking();
      else stopDomTracking();
    }

    applyFlag();
    const id = setInterval(applyFlag, FLAG_POLL_MS);
    return () => clearInterval(id);
  }, [storeId, isAdminRoute]);

  // Unmount (a full teardown, not a route change) stops everything.
  useEffect(() => {
    return () => {
      setActivityLoggingEnabled(false);
      stopDomTracking();
    };
  }, []);

  // --- attribution -----------------------------------------------------------
  // The logger caches the signed-in identity for a few seconds to avoid parsing
  // localStorage on every event. A login or logout must clear that immediately,
  // or the first events after a shift change land on the wrong person.
  useEffect(() => {
    invalidateActivityIdentity();
  }, [user?.id, user?.storeId]);

  // --- navigation ------------------------------------------------------------
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    const from = lastPath.current;
    lastPath.current = pathname;
    if (isAdminRoute) return;
    logActivity("nav.route", { target: pathname, details: { from } });
    // Timing rides alongside the trail event rather than replacing it: nav.route
    // is the audit record of where someone went, perf.route is how long it took.
    // The clock stops at the new route's paint, inside logPerfRouteArrival.
    logPerfRouteArrival(pathname, from ?? undefined);
  }, [pathname, isAdminRoute]);

  return null;
}

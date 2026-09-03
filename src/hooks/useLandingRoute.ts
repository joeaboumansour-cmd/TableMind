"use client";

// =============================================
// useLandingRoute — where to send someone after they sign in.
//
// Login used to hardcode /pos. That is right for most people and wrong for the
// ones it matters to: a cash-only or kitchen-only employee landed on a screen
// their own permissions bounce them off, which reads as a broken login.
//
// IMPORTANT: this calls useFeatureFlags() exactly ONCE and does NOT call
// useVisibleTabs(). Two independent useFeatureFlags() instances answering the
// same question resolve on different ticks, and that exact race is what left
// the cart buttons trapped under the tab bar (see the note atop tabs.ts). One
// instance per screen.
// =============================================

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { pickLandingRoute, TABS } from "@/components/nav/tabs";

/**
 * How long to wait for the store's feature flags before landing anyway.
 *
 * Flags come from localStorage first, so on any returning device this resolves
 * on the next render and the timeout never fires. It exists for the first-ever
 * login on a device, and for a first login made offline — neither of which may
 * leave a cashier watching a spinner.
 */
const FLAG_WAIT_MS = 1200;

export interface LandingRoute {
  href: string | null;
  /** False while we are still waiting to know. Never stays false forever. */
  resolved: boolean;
}

export function useLandingRoute(): LandingRoute {
  const { user, canAccess } = useAuth();
  // `flagsResolved`, not `isLoading`: it is the field that distinguishes an
  // answer from a guess.
  const { isEnabled, flagsResolved } = useFeatureFlags();
  const [waited, setWaited] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user || flagsResolved) return;
    timer.current = setTimeout(() => setWaited(true), FLAG_WAIT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [user, flagsResolved]);

  if (!user) return { href: null, resolved: false };

  if (flagsResolved) {
    return { href: pickLandingRoute(canAccess, isEnabled), resolved: true };
  }

  if (!waited) return { href: null, resolved: false };

  // Flags never arrived. Fall back to permissions alone, ignoring features.
  //
  // This is flash-free in the overwhelmingly common case because /pos carries
  // NO `feature` key in TABS — it can never be bounced by a feature guard, so
  // anyone with the pos permission lands somewhere that will definitely hold.
  const byPermissionOnly = TABS.find((t) => canAccess(t.section));
  return { href: byPermissionOnly?.href ?? null, resolved: true };
}

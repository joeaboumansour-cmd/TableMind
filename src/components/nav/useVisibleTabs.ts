"use client";

// Split out of tabs.ts so that file stays pure data and predicates. Importing
// AuthContext from there pulled the connectivity heartbeat into every consumer
// of TABS, including the node-environment harness.
//
// IMPORTANT: call this ONCE per shell, in AppShell, and pass the result down.
// Two independent useFeatureFlags() instances answering the same question
// resolve on different ticks, and that race is what previously left the cart's
// buttons trapped under the tab bar. See the note atop AppShell.tsx.

import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { TABS, type Tab } from "./tabs";

/** Which tabs this user can actually see. */
export function useVisibleTabs(): Tab[] {
  const { user, canAccess } = useAuth();
  const { isEnabled } = useFeatureFlags();

  if (!user) return [];
  return TABS.filter(
    (t) => canAccess(t.section) && (!t.feature || isEnabled(t.feature))
  );
}

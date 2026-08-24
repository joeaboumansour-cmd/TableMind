"use client";

// =============================================
// Shared navigation model
//
// One list of destinations, used by BOTH the mobile bottom bar and the desktop
// top bar. Extracted from BottomTabBar when the desktop nav was added.
//
// IMPORTANT: useVisibleTabs() must be called ONCE per shell, by AppShell, and
// the result passed down to whichever bar is rendering. Do not call it inside
// the bars themselves. Two independent useFeatureFlags() instances answering
// the same question resolve on different ticks, and that exact race is what
// previously left the cart's Done / Checkout buttons trapped under the tab bar
// (see the comment at the top of AppShell.tsx).
// =============================================

import { ScanLine, History, Package, Banknote } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { SectionKey } from "@/lib/auth/permissions";

export interface Tab {
  href: string;
  label: string;
  icon: typeof ScanLine;
  /** Permission required to see this tab. */
  section: SectionKey;
  /** Store feature flag required to see this tab, if any. */
  feature?: string;
  /** Sub-routes that should also light this tab up. */
  matches?: (pathname: string) => boolean;
}

export const TABS: Tab[] = [
  {
    href: "/pos",
    label: "Sell",
    icon: ScanLine,
    section: "pos",
    // /pos and /checkout — NOT /pos/products or /pos/cash, which are their own
    // tabs. Checkout is the back half of the same sale, so leaving every tab
    // unlit there would read as "you are nowhere".
    matches: (p) => p === "/pos" || p.startsWith("/checkout"),
  },
  {
    href: "/transactions",
    label: "History",
    icon: History,
    section: "transactions",
    feature: "transactions",
    matches: (p) => p.startsWith("/transactions"),
  },
  {
    href: "/pos/products",
    label: "Inventory",
    icon: Package,
    section: "inventory",
    feature: "inventory",
    matches: (p) => p.startsWith("/pos/products"),
  },
  {
    href: "/pos/cash",
    label: "Cash",
    icon: Banknote,
    section: "cash_register",
    feature: "cash_register",
    matches: (p) => p.startsWith("/pos/cash"),
  },
];

/** Which tabs this user can actually see. Call once, in AppShell. */
export function useVisibleTabs(): Tab[] {
  const { user, canAccess } = useAuth();
  const { isEnabled } = useFeatureFlags();

  if (!user) return [];
  return TABS.filter(
    (t) => canAccess(t.section) && (!t.feature || isEnabled(t.feature))
  );
}

/**
 * Whether the tab row is worth showing at all.
 *
 * One destination is not navigation -- a bar with a single tab reads as
 * broken rather than minimal. Both bars share this rule so they can never
 * drift apart on it.
 *
 * NOTE this governs the tab ROW, not the bar around it. DesktopNav also
 * carries the sync indicator, the user label and the ONLY desktop sign-out,
 * so it renders whenever someone is signed in and merely hides the row.
 * BottomTabBar carries nothing else, so an empty row means an empty bar and
 * it hides completely. That asymmetry is deliberate; see BottomTabBar.
 */
export function shouldShowTabList(tabs: Tab[]): boolean {
  return tabs.length >= 2;
}

/** True when `pathname` is the tab's destination. */
export function isTabActive(tab: Tab, pathname: string): boolean {
  return tab.matches ? tab.matches(pathname) : pathname === tab.href;
}

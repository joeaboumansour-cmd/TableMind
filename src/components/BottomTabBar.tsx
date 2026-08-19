"use client";

// =============================================
// Bottom tab bar
//
// Replaces the mobile hamburger menu that used to live in the POS header.
// A hamburger is the least app-like navigation pattern for a device held in
// one hand: the primary destinations were two taps deep and hidden behind a
// dropdown. A thumb-reachable tab bar makes them one tap and always visible.
//
// Rendered from the (shell) layout so it stays MOUNTED across navigations —
// it does not flicker or rebuild when the route changes.
//
// Desktop keeps its existing header buttons; this is mobile-only (md:hidden).
// =============================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { ScanLine, History, Package, Banknote, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import type { SectionKey } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { vibrate } from "@/lib/feedback";

interface Tab {
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

const TABS: Tab[] = [
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

/**
 * Which tabs this user can actually see.
 *
 * Deliberately NOT exported. It was, so the shell could reserve room for a
 * fixed bar — but that meant two independent useFeatureFlags() instances
 * deciding the same question and resolving on different ticks. The bar is in
 * flow now, so this is the only place that needs the answer.
 */
function useVisibleTabs(): Tab[] {
  const { user, canAccess } = useAuth();
  const { isEnabled } = useFeatureFlags();

  if (!user) return [];
  return TABS.filter(
    (t) => canAccess(t.section) && (!t.feature || isEnabled(t.feature))
  );
}

export default function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const visible = useVisibleTabs();
  // Gives the tapped tab an immediate pending state. Navigations were
  // imperative router.push() calls with no feedback at all, so the screen just
  // froze on the old page until the next route painted.
  const [isPending, startTransition] = useTransition();

  // A single tab is not navigation.
  if (visible.length < 2) return null;

  return (
    <nav
      aria-label="Main"
      className={cn(
        // In flow (see AppShell for why), but with an explicit stacking
        // position so nothing paints over it. That was the real defect behind
        // "the nav bar disappears": as an unpositioned flex child it had no
        // z-index at all, and the PWA install prompt — fixed, z-50 — simply
        // covered it.
        //
        // z-40 is deliberately BELOW the z-50 used by dialogs, because a modal
        // SHOULD cover navigation, and above ambient floating UI at z-30.
        "md:hidden relative z-40 flex-shrink-0",
        // A hairline and the page's own background, not a raised card: the bar
        // should read as the edge of the screen, not a slab sitting on it.
        "border-t border-white/[0.06] bg-background",
        // Bottom inset that adapts per device — ~34px of home indicator on
        // iOS, a 6px breathing gap on Android where the inset is 0.
        "tab-bar-inset"
      )}
    >
      <ul className="flex items-stretch">
        {visible.map((tab) => {
          const active = tab.matches ? tab.matches(pathname) : pathname === tab.href;
          const Icon = tab.icon;

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                // Link gives us automatic prefetching, which router.push did
                // not. The transition is what surfaces pending state.
                onClick={(e) => {
                  if (active) return;
                  e.preventDefault();
                  vibrate(15);
                  startTransition(() => router.push(tab.href));
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 48px row. With the device inset below it the whole bar
                  // lands at ~82px on iOS — the same weight as a native tab
                  // bar — instead of the 90px slab it had grown into.
                  "tap flex min-h-12 flex-col items-center justify-center gap-1 px-1 py-1.5",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {isPending && !active ? (
                  <Loader2 className="h-[19px] w-[19px] animate-spin" aria-hidden />
                ) : (
                  // Weight, not scale, carries the active state — a thicker
                  // stroke reads as deliberate where a 10% bump reads as a
                  // rendering wobble.
                  <Icon
                    className="h-[19px] w-[19px]"
                    strokeWidth={active ? 2.4 : 1.8}
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "text-[10px] leading-none tracking-tight",
                    active ? "font-semibold" : "font-medium"
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

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
    // /pos only — NOT /pos/products or /pos/cash, which are their own tabs.
    matches: (p) => p === "/pos",
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

export default function BottomTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { isEnabled } = useFeatureFlags();
  // Gives the tapped tab an immediate pending state. Navigations were
  // imperative router.push() calls with no feedback at all, so the screen just
  // froze on the old page until the next route painted.
  const [isPending, startTransition] = useTransition();

  if (!user) return null;

  const visible = TABS.filter(
    (t) => canAccess(t.section) && (!t.feature || isEnabled(t.feature))
  );

  // A single tab is not navigation.
  if (visible.length < 2) return null;

  return (
    <nav
      aria-label="Main"
      className={cn(
        "md:hidden flex-shrink-0 border-t bg-background",
        // Clears the iOS home indicator; the page paints under it because
        // layout.tsx sets viewportFit: 'cover'.
        "safe-bottom"
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
                  // 56px min target — comfortably above the 44px guideline,
                  // and reachable one-handed.
                  "flex flex-col items-center justify-center gap-0.5 min-h-14 py-2 px-1",
                  "transition-colors active:bg-muted/60",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {isPending && !active ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <Icon
                    className={cn("h-5 w-5", active && "scale-110")}
                    aria-hidden
                  />
                )}
                <span className="text-[11px] font-medium leading-none">
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

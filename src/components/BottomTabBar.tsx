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
// Mobile only (md:hidden). The desktop counterpart is
// src/components/nav/DesktopNav.tsx; AppShell renders both and decides which
// is visible purely in CSS, so they can never appear at once.
//
// The tab list arrives as a prop. See src/components/nav/tabs.ts for why it
// must be resolved once, by AppShell, rather than here.
// =============================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { vibrate } from "@/lib/feedback";
import { isTabActive, shouldShowTabList, type Tab } from "./nav/tabs";

export default function BottomTabBar({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const router = useRouter();
  // Gives the tapped tab an immediate pending state. Navigations were
  // imperative router.push() calls with no feedback at all, so the screen just
  // froze on the old page until the next route painted.
  const [isPending, startTransition] = useTransition();

  // Unlike DesktopNav this bar holds nothing but tabs, so no tabs means no
  // bar. That is fine ONLY because sign-out on mobile lives in the POS page's
  // own header (the door icon, top right) rather than here.
  //
  // Do not remove that button. The desktop equivalent was removed when the
  // global nav arrived, and an employee with POS access alone -- one tab --
  // was left in the till with no way to log out. This bar disappearing under
  // exactly those conditions is the same trap, one screen away.
  if (!shouldShowTabList(tabs)) return null;

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
        {tabs.map((tab) => {
          const active = isTabActive(tab, pathname);
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

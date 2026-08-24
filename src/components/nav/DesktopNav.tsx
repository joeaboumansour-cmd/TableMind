"use client";

// =============================================
// Desktop top bar
//
// The counterpart to BottomTabBar. Until this existed, desktop had NO
// navigation chrome at all: BottomTabBar is md:hidden, so on a shop till the
// only way between screens was whatever buttons a given page happened to
// render. That is the gap this closes.
//
// Rendered by AppShell as a flex sibling above the content, in flow, for the
// same reason the bottom bar is — see the comment at the top of AppShell.tsx.
// It receives its tabs as a prop rather than calling useVisibleTabs() itself,
// so there is exactly one useFeatureFlags() instance per shell.
// =============================================

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { cn } from "@/lib/utils";
import { SyncIndicator } from "@/components/SyncIndicator";
import LogoutButton from "./LogoutButton";
import { isTabActive, shouldShowTabList, type Tab } from "./tabs";

export default function DesktopNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [isPending, startTransition] = useTransition();

  // Render whenever there is a signed-in user, NOT only when there are tabs to
  // show. This bar is the only sign-out on desktop -- the POS page's own header
  // was removed when it was added -- so an employee with POS access alone has
  // exactly one tab, and returning null here stranded them in the till with no
  // way out. Mobile was unaffected because the mobile POS branch carries its
  // own sign-out button.
  if (!user) return null;

  // Same rule as the mobile bar, from the same place -- but applied to the tab
  // LIST only, because the chrome around it carries the sync indicator, the
  // user label and the only desktop sign-out.
  const showTabs = shouldShowTabList(tabs);

  return (
    <nav
      aria-label="Main"
      className={cn(
        // Mirror image of the bottom bar: shown only where that one is hidden,
        // so the two can never both appear.
        "hidden md:flex relative z-40 flex-shrink-0 items-center gap-1",
        "h-14 border-b border-white/[0.06] bg-background px-3"
      )}
    >
      <span className="mr-3 select-none px-2 text-sm font-semibold tracking-tight">
        Golden<span className="text-primary">Squirrel</span>
      </span>

      {showTabs ? (
      <ul className="flex items-center gap-1">
        {tabs.map((tab) => {
          const active = isTabActive(tab, pathname);
          const Icon = tab.icon;

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                onClick={(e) => {
                  if (active) return;
                  e.preventDefault();
                  startTransition(() => router.push(tab.href));
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-semibold text-primary"
                    : "font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                )}
              >
                {isPending && !active ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Icon className="h-4 w-4" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                )}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
      ) : null}

      {/* Connection state and sign-out are the same question on every screen,
          so they live here rather than being re-implemented per page. The POS
          desktop header used to carry its own copies. */}
      <div className="ml-auto flex items-center gap-2 pl-3">
        <SyncIndicator />
        <span className="max-w-[12rem] truncate text-xs text-muted-foreground">
          {user.displayName || user.username}
        </span>
        <LogoutButton />
      </div>
    </nav>
  );
}

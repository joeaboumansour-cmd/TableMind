"use client";

// =============================================
// App shell
//
// The screen fills the viewport minus the bottom tab bar, and the bar itself
// is position:fixed on top of everything (see BottomTabBar). Content does not
// sit *under* it — the shell reserves exactly --tab-bar-h of room — so the two
// never overlap, and no page's own layout can push navigation off-screen or
// let an overlay cover it.
//
// Every screen inside the shell therefore gets a fixed, known height and is
// expected to lay itself out with `h-full` and its own internal scrolling,
// rather than growing the page.
//
// Shared by the (shell) route group and /checkout so the bar cannot drift out
// of sync between them.
// =============================================

import BottomTabBar, { useHasBottomTabs } from "@/components/BottomTabBar";
import { cn } from "@/lib/utils";

export default function AppShell({ children }: { children: React.ReactNode }) {
  // No bar rendered (desktop, or a user with a single permitted section) means
  // no space reserved — otherwise those users get a dead strip at the bottom.
  const hasTabs = useHasBottomTabs();

  return (
    // dvh (not vh) so the shell tracks the real visible viewport on iOS Safari
    // rather than extending behind the browser chrome.
    <div className="relative h-dvh overflow-hidden">
      <div
        className={cn(
          "h-full overflow-hidden",
          // border-box sizing means this padding comes out of the 100%, so the
          // content box is exactly the space above the bar.
          hasTabs && "pb-[var(--tab-bar-h)]"
        )}
      >
        {children}
      </div>
      <BottomTabBar />
    </div>
  );
}

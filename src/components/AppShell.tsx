"use client";

// =============================================
// App shell
//
// One flex column: the screen fills the space it is given, and the bottom tab
// bar is a permanent sibling below it — never overlaid, never scrolled past.
// Every screen inside the shell therefore gets a fixed, known height and is
// expected to lay itself out with `h-full` and its own internal scrolling,
// rather than growing the page.
//
// Shared by the (shell) route group and /checkout so the bar cannot drift out
// of sync between them.
// =============================================

import BottomTabBar from "@/components/BottomTabBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    // dvh (not vh) so the bar sits on the real visible viewport on iOS Safari
    // rather than behind the browser chrome.
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <BottomTabBar />
    </div>
  );
}

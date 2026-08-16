"use client";

// =============================================
// App shell
//
// A route group — the "(shell)" folder name does NOT appear in URLs, so /pos,
// /pos/products, /pos/cash and /transactions are unchanged. What it buys is a
// shared layout: React keeps this subtree mounted across navigations between
// those routes, so the tab bar persists instead of being torn down and
// rebuilt on every move. That continuity is most of what separates an app
// from a set of web pages.
//
// Deliberately NOT included: /checkout. It is a focused payment flow, and a
// visible tab bar there invites navigating away mid-transaction.
// =============================================

import BottomTabBar from "@/components/BottomTabBar";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // dvh (not vh) so the bar sits on the real visible viewport on iOS Safari
    // rather than behind the browser chrome.
    <div className="flex flex-col h-dvh overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      <BottomTabBar />
    </div>
  );
}

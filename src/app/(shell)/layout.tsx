"use client";

// =============================================
// (shell) route group
//
// The "(shell)" folder name does NOT appear in URLs, so /pos, /pos/products,
// /pos/cash and /transactions are unchanged. What it buys is a shared layout:
// React keeps this subtree mounted across navigations between those routes, so
// the tab bar persists instead of being torn down and rebuilt on every move.
// That continuity is most of what separates an app from a set of web pages.
//
// /checkout is NOT in this group (it is a separate flow with its own route),
// but it renders the same AppShell via src/app/checkout/layout.tsx, so the tab
// bar is present and identical there too.
// =============================================

import AppShell from "@/components/AppShell";
import DurabilityBanner from "@/components/pos/DurabilityBanner";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The durability alarm lives HERE rather than in AppShell, so it is on every
  // screen a cashier is on between sales — the till, inventory, cash, history —
  // and on none during payment. /checkout renders the same AppShell without it.
  //
  // It renders nothing at all unless money is actually at risk on this device;
  // see DurabilityBanner for why that condition is narrower than "the app is
  // not installed".
  return <AppShell banner={<DurabilityBanner />}>{children}</AppShell>;
}

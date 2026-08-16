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

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

"use client";

// =============================================
// Checkout layout
//
// Checkout used to sit outside the shell on purpose — the reasoning was that a
// visible tab bar invites a cashier to wander off mid-payment. In practice a
// bar that disappears on one screen is worse: navigation the user has to
// rediscover reads as broken, and the cart survives the trip anyway (it is
// persisted), so the only thing a stray tap costs is a re-typed amount.
// =============================================

import AppShell from "@/components/AppShell";

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

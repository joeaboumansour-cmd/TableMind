"use client";

// =============================================
// App shell
//
// One flex column: the screen fills the space it is given, and the bottom tab
// bar is a permanent sibling below it. Every screen inside the shell therefore
// gets a fixed, known height and is expected to lay itself out with `h-full`
// and its own internal scrolling, rather than growing the page.
//
// The bar is IN FLOW on purpose. It was briefly position:fixed with the shell
// reserving space via a --tab-bar-h padding, which introduced a race: the
// shell and the bar each decided independently whether tabs were visible, via
// separate useFeatureFlags() instances that resolve on different ticks. On a
// reload the bar could render before the shell reserved room for it, and the
// content underneath — the cart's Done / Checkout buttons — stayed trapped
// under the bar.
//
// In flow there is nothing to keep in sync: the bar occupies its own space or
// none at all. It cannot be pushed off either, being flex-shrink-0 inside a
// clipped, fixed-height column. Overlays covering it (the original problem)
// are solved by its z-index, not by its positioning.
//
// Shared by the (shell) route group and /checkout so the bar cannot drift out
// of sync between them.
// =============================================

import BottomTabBar from "@/components/BottomTabBar";
import DesktopNav from "@/components/nav/DesktopNav";
import { useVisibleTabs } from "@/components/nav/tabs";

export default function AppShell({
  children,
  banner,
}: {
  children: React.ReactNode;
  /**
   * A flex-shrink-0 row above the screen, for something the shop must not miss.
   *
   * A SLOT rather than a component rendered here, because /checkout shares this
   * shell and must not get one: a row appearing mid-payment both distracts the
   * cashier and takes height from the keypad on a 1366x768 till. The (shell)
   * group passes one; /checkout does not.
   */
  banner?: React.ReactNode;
}) {
  // Resolved ONCE here and handed to both bars. Two components each calling
  // useFeatureFlags() would answer the same question on different ticks, which
  // is the race described above.
  const tabs = useVisibleTabs();

  return (
    // h-app, not h-dvh: the height comes from visualViewport via
    // ViewportHeightSync, which is the only measurement that stays correct
    // while Android's URL bar slides in and out. dvh remains the fallback
    // until that first measurement lands.
    <div className="flex h-app flex-col overflow-hidden">
      <DesktopNav tabs={tabs} />
      {banner}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      <BottomTabBar tabs={tabs} />
    </div>
  );
}

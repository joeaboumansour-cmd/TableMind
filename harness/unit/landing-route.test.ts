// =============================================
// Characterization: pickLandingRoute in src/components/nav/tabs.ts
//
// Login used to send everyone to /pos. That is right for most people and wrong
// for the ones it matters to: a cash-only or kitchen-only employee landed on a
// screen their own permission guard bounces them off, which reads as a broken
// sign-in rather than as a missing permission.
//
// The property worth pinning is that this and the tab bar agree — a landing
// route the bar would not show is a screen the person cannot get back to.
// =============================================

import { describe, it, expect } from "vitest";
import { TABS, pickLandingRoute } from "@/components/nav/tabs";
import type { SectionKey } from "@/lib/auth/permissions";

const allowAll = () => true;
const denyAll = () => false;

/** Only these sections are permitted. */
const only =
  (...sections: SectionKey[]) =>
  (section: SectionKey) =>
    sections.includes(section);

describe("pickLandingRoute", () => {
  it("sends an owner to the till", () => {
    expect(pickLandingRoute(allowAll, allowAll)).toBe("/pos");
  });

  it("sends a pos-only cashier to the till", () => {
    expect(pickLandingRoute(only("pos"), allowAll)).toBe("/pos");
  });

  it("sends a cash-only employee to the cash page, not the till", () => {
    expect(pickLandingRoute(only("cash_register"), allowAll)).toBe("/pos/cash");
  });

  it("sends a kitchen-only employee to the board", () => {
    expect(pickLandingRoute(only("kitchen"), allowAll)).toBe("/kitchen");
  });

  it("returns null when nothing is reachable, rather than guessing", () => {
    // The caller shows "no sections are enabled" instead of navigating into a
    // guard that would bounce straight back to /login.
    expect(pickLandingRoute(denyAll, allowAll)).toBeNull();
  });

  it("respects the store's feature flags, not just permissions", () => {
    // Permission to see history, but the store does not have the feature.
    expect(pickLandingRoute(only("transactions"), denyAll)).toBeNull();
  });

  it("skips a flagged-off section and lands on the next reachable one", () => {
    const can = only("transactions", "cash_register");
    const isEnabled = (f: string) => f !== "transactions";
    expect(pickLandingRoute(can, isEnabled)).toBe("/pos/cash");
  });

  it("never returns a route the tab bar would not show", () => {
    // The bar filters TABS by exactly the same two predicates, so a landing
    // route it would hide is a screen with no way back to it.
    const can = only("cash_register", "kitchen");
    const isEnabled = (f: string) => f !== "kitchen_display";
    const href = pickLandingRoute(can, isEnabled);
    const visible = TABS.filter(
      (t) => can(t.section) && (!t.feature || isEnabled(t.feature))
    ).map((t) => t.href);
    expect(href).not.toBeNull();
    expect(visible).toContain(href);
  });

  it("/pos carries no feature flag, so it cannot be bounced by one", () => {
    // Load-bearing for useLandingRoute's fallback: when flags never resolve it
    // lands on /pos, which is only safe because no feature guard sits on it.
    const pos = TABS.find((t) => t.href === "/pos");
    expect(pos?.feature).toBeUndefined();
  });
});

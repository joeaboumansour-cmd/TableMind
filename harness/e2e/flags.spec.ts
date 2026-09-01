// =============================================
// Feature flags — an unresolved flag is not a negative answer.
//
// `useFeatureFlags` serves `optimisticDefaults()` before anything has told the
// device what this store has switched on, and most flags default to FALSE. A
// screen that acts on that guess acts on nothing.
//
// Both tests below run on a FRESH context, which is the population that hits
// this: a new device, cleared storage, evicted storage, a private window.
// =============================================

import { test, expect } from "./fixtures";

test.describe("feature flags", () => {
  /**
   * ⚠️ REGRESSION GUARD — this was live.
   *
   * `cash_register` defaults to false. The cash page's guard keyed on
   * `isLoading`, which goes false as soon as there is something renderable —
   * the guess. Opening /pos/cash on a device with no cached flags therefore
   * redirected to /pos with "Cash Register is not enabled for this store", for
   * a store that has it switched on. Reproduced on the pre-fix build
   * 2026-09-01; the guard keys on `flagsResolved` now.
   *
   * The PERMISSION check is the security boundary and is untouched — this is
   * only about not denying before there is an answer to deny on.
   */
  test("the cash page is not bounced on a device with no cached flags", async ({ signedIn: page }) => {
    await page.goto("/pos/cash");
    await page.waitForTimeout(6_000);

    expect(page.url()).toContain("/pos/cash");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("not enabled for this store");
  });

  /**
   * The flags are fetched ONCE for a walk across three screens.
   *
   * `useFeatureFlags` is mounted by around ten components and had no stale
   * window, so every screen mount re-fetched them — three times for this walk.
   * It is a resource now; this pins the window that collapsed them.
   */
  test("the flags are fetched once across a three-screen walk", async ({ signedIn: page }) => {
    let fetches = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/admin/stores/features") fetches += 1;
    });

    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    await page.getByRole("link", { name: "History" }).first().click();
    await page.waitForTimeout(3_000);

    await page.getByRole("link", { name: "Sell" }).first().click();
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    expect(fetches).toBe(1);
  });
});

// =============================================
// Visual snapshots — every screen, at three viewports.
//
// This is what turns "keep the UI as it is" from a promise into a gate.
//
// ── THE RULE THAT MAKES THESE COMPATIBLE WITH PHASE 5 ────────────────────────
// SNAPSHOTS ASSERT SETTLED STATES ONLY. NEVER a mid-load state.
//
// Phase 5 deliberately changes what appears *while* something is arriving —
// that is the entire point of it. A snapshot that pinned a spinner in place
// would forbid the improvement it exists alongside. So every capture below
// waits for the screen to be finished, and the loading states are explicitly
// out of scope.
// ─────────────────────────────────────────────────────────────────────────────
//
// Anything that legitimately differs run to run is MASKED rather than
// stabilised: clocks, relative times, sync status, generated ids. Masking is
// honest about what is not being asserted; faking a frozen clock would make
// the snapshot claim to cover something it does not.
// =============================================

import { test, expect } from "@playwright/test";
import { signIn } from "../e2e/fixtures";
import type { Page } from "@playwright/test";

/**
 * Regions that change between runs for reasons that are not UI changes.
 *
 * Masked, not stubbed: a masked box says "this varied and was not asserted",
 * which is true. Freezing the clock would say "this was asserted and matched",
 * which would not be.
 */
function volatile(page: Page) {
  return [
    page.locator("[data-sync-status]"),
    page.locator("time"),
    // The connectivity pill flips between Connected / Syncing / Offline
    // depending on where the heartbeat happens to be.
    page.getByText(/^(Connected|Offline|Syncing|Saved on this till)$/),
    // Relative timestamps on history rows and cash cards.
    page.getByText(/\b\d+\s+(second|minute|hour|day)s?\s+ago\b/),
    // Absolute dates and times.
    page.getByText(/\b\d{1,2}:\d{2}\s?(AM|PM)?\b/),
  ];
}

async function settle(page: Page) {
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 45_000 });
  // Fonts affect metrics on every text node; capturing before they are ready
  // produces a diff on every run for no reason.
  await page.evaluate(() => document.fonts.ready);
  // One idle frame so any entrance transition has finished. `animations:
  // "disabled"` in the config handles CSS animations; this covers the rest.
  await page.waitForTimeout(600);
}

const SCREENS: Array<{ name: string; path: string }> = [
  { name: "pos",           path: "/pos" },
  { name: "transactions",  path: "/transactions" },
  { name: "inventory",     path: "/pos/products" },
  { name: "cash",          path: "/pos/cash" },
  { name: "kitchen",       path: "/kitchen" },
];

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.addInitScript(() => localStorage.removeItem("goldensquirrel-cart"));
});

for (const screen of SCREENS) {
  test(`${screen.name} — settled`, async ({ page }) => {
    await page.goto(screen.path);
    await settle(page);

    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: false,
      mask: volatile(page),
      maxDiffPixelRatio: 0.01,
    });
  });
}

test("checkout — settled, with a line in the cart", async ({ page }) => {
  await page.goto("/pos");
  await settle(page);

  const box = page.getByLabel("Scan a barcode or search products");
  // VISIBILITY, not presence. The three viewports here are one desktop user
  // agent at three widths, so `isMobile()` reports desktop and the Pro till
  // renders even at 375px — where the remembered 380px cart panel squeezes the
  // scan input to ZERO WIDTH. Guarding on `count() === 0` therefore did not
  // skip; it found the input, tried to click something invisible, and timed
  // out after 90 seconds. An input with no width is the absence of the UI.
  test.skip(!(await box.isVisible()), "wedge-driven; the mobile till is camera-first");

  await box.click();
  await box.pressSequentially("2000000000001", { delay: 8 });
  await box.press("Enter");

  await expect
    .poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("goldensquirrel-cart");
      if (!raw) return 0;
      const s = JSON.parse(raw).state;
      return s.lanes?.[s.activeLaneId]?.items?.length ?? 0;
    }), { timeout: 15_000 })
    .toBe(1);

  await page.getByRole("button", { name: /^Checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout/, { timeout: 15_000 });
  await settle(page);

  await expect(page).toHaveScreenshot("checkout.png", {
    fullPage: false,
    mask: volatile(page),
    maxDiffPixelRatio: 0.01,
  });
});

test("pos with a cart line — settled", async ({ page }) => {
  await page.goto("/pos");
  await settle(page);

  const box = page.getByLabel("Scan a barcode or search products");
  // VISIBILITY, not presence. The three viewports here are one desktop user
  // agent at three widths, so `isMobile()` reports desktop and the Pro till
  // renders even at 375px — where the remembered 380px cart panel squeezes the
  // scan input to ZERO WIDTH. Guarding on `count() === 0` therefore did not
  // skip; it found the input, tried to click something invisible, and timed
  // out after 90 seconds. An input with no width is the absence of the UI.
  test.skip(!(await box.isVisible()), "wedge-driven; the mobile till is camera-first");

  await box.click();
  await box.pressSequentially("2000000000001", { delay: 8 });
  await box.press("Enter");
  await expect
    .poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("goldensquirrel-cart");
      if (!raw) return 0;
      const s = JSON.parse(raw).state;
      return s.lanes?.[s.activeLaneId]?.items?.length ?? 0;
    }), { timeout: 15_000 })
    .toBe(1);
  await settle(page);

  await expect(page).toHaveScreenshot("pos-with-cart.png", {
    fullPage: false,
    mask: volatile(page),
    maxDiffPixelRatio: 0.01,
  });
});

test("modifier sheet — settled", async ({ page }) => {
  await page.goto("/pos");
  await settle(page);

  const box = page.getByLabel("Scan a barcode or search products");
  test.skip(!(await box.isVisible()), "the modifier sheet opens from the desktop Pro till");

  // Warm the recipe cache, then reload so React holds it (see menu.spec.ts).
  await expect
    .poll(() => page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("store_recipes_"));
      if (!key) return 0;
      try { return Object.keys(JSON.parse(localStorage.getItem(key)!)).length; } catch { return 0; }
    }), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.reload();
  await settle(page);

  const box2 = page.getByLabel("Scan a barcode or search products");
  await box2.click();
  await box2.pressSequentially("2900000000073", { delay: 8 });
  await box2.press("Enter");

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await settle(page);

  await expect(page).toHaveScreenshot("modifier-sheet.png", {
    fullPage: false,
    mask: volatile(page),
    maxDiffPixelRatio: 0.01,
  });
});

test("login — settled", async ({ page, context }) => {
  // No session: the signed-out screen is a real state and worth pinning.
  await context.clearCookies();
  await page.addInitScript(() => {
    localStorage.removeItem("goldensquirrel_user");
    localStorage.removeItem("goldensquirrel_auth");
  });
  await page.goto("/login");
  await settle(page);

  await expect(page).toHaveScreenshot("login.png", {
    fullPage: false,
    mask: volatile(page),
    maxDiffPixelRatio: 0.01,
  });
});

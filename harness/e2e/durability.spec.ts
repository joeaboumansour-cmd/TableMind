// =============================================
// Offline durability — Phase 6.
//
// The thing being protected is a shop that has been offline, or whose storage
// the browser cleared, still behaving correctly rather than confidently wrong.
// =============================================

import { test, expect, FIXTURE, STORE_ID } from "./fixtures";

const scanBox = (page: import("@playwright/test").Page) =>
  page.getByLabel("Scan a barcode or search products");

test.describe("a device that has never been told the catalogue", () => {
  /**
   * ⚠️ REGRESSION GUARD.
   *
   * An empty `products_cache` means one of two opposite things: "this shop
   * sells nothing", or "this device has not been told yet". The till used to
   * treat both as the first — so a cashier scanning a real product on a new
   * till, or on one whose storage iOS cleared after seven idle days, was
   * offered the name-and-price fields and invited to create a DUPLICATE of
   * something the shop already sells, priced by guess.
   *
   * The catalogue request is blocked so the device provably cannot know, which
   * is also the honest model of the real case: offline, with nothing cached.
   */
  test("an unknown barcode is not an invitation to create a duplicate", async ({ signedIn: page }) => {
    await page.route("**/rest/v1/products**", (route) => route.abort());

    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });
    const box = scanBox(page);
    test.skip((await box.count()) === 0, "the unknown-barcode prompt is on the desktop Pro till");

    // Proof the device genuinely knows nothing: no catalogue, no watermark.
    const known = await page.evaluate((store) => ({
      watermark: localStorage.getItem(`products_last_sync_${store}`),
      legacy: localStorage.getItem("products_last_sync"),
    }), STORE_ID);
    expect(known.watermark).toBeNull();
    expect(known.legacy).toBeNull();

    await box.click();
    await box.pressSequentially(FIXTURE.productBarcode, { delay: 8 });
    await box.press("Enter");

    const body = page.locator("body");
    await expect(body).toContainText("has not downloaded the product list", { timeout: 20_000 });

    // The create-a-product fields must NOT be offered, and nothing may reach
    // the cart on a guess.
    await expect(page.getByText("is not in the catalogue")).toHaveCount(0);
    const items = await page.evaluate(() => {
      const raw = localStorage.getItem("goldensquirrel-cart");
      if (!raw) return 0;
      const s = JSON.parse(raw).state;
      return s.lanes?.[s.activeLaneId]?.items?.length ?? 0;
    });
    expect(items).toBe(0);
  });

  /**
   * The other half: once the device HAS been told, an unknown barcode is a real
   * answer again and the normal prompt returns. Without this the fix above
   * could be "never offer to add a product", which would break the till's
   * unknown-barcode flow entirely.
   */
  test("once the catalogue is known, an unknown barcode prompts as usual", async ({ signedIn: page }) => {
    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });
    const box = scanBox(page);
    test.skip((await box.count()) === 0, "the unknown-barcode prompt is on the desktop Pro till");

    await expect
      .poll(() => page.evaluate((store) => localStorage.getItem(`products_last_sync_${store}`), STORE_ID),
            { timeout: 30_000 })
      .not.toBeNull();

    await box.click();
    await box.pressSequentially("2999999999999", { delay: 8 });
    await box.press("Enter");

    await expect(page.locator("body")).toContainText("2999999999999", { timeout: 20_000 });
    await expect(page.getByText("has not downloaded the product list")).toHaveCount(0);
  });
});

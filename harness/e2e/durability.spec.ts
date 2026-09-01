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

test.describe("the durability alarm", () => {
  /**
   * Phase 6.1's exit criterion: "the 'at risk' state is impossible to be in
   * without the shop being told."
   *
   * Persistence cannot be revoked from a test, so the condition is produced the
   * other way round: put a completed sale in the queue and deny the grant, then
   * assert the shop is told. `navigator.storage.persist` is stubbed BEFORE the
   * app loads, which is exactly what an uninstalled browser tab does.
   */
  test("a queued sale on an evictable device is announced, and cannot be dismissed", async ({ signedIn: page }) => {
    await page.addInitScript(() => {
      // An uninstalled tab: the API exists and simply says no.
      Object.defineProperty(navigator.storage, "persist", {
        configurable: true,
        value: async () => false,
      });
      Object.defineProperty(navigator.storage, "persisted", {
        configurable: true,
        value: async () => false,
      });
    });

    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });

    // Skip where the engine has no Storage API — tested for, not hardcoded by
    // platform name, so this follows the capability rather than a guess.
    //
    // Playwright's WebKit build has NO `navigator.storage` at all, and the app
    // is right to show nothing there: with no way to ask, "unknown" is the
    // honest answer and an alarm would be a fabrication. Note this is a harness
    // limitation, NOT a statement about iOS — real Safari does implement
    // `storage.persist()`, and on iOS the install IS the durability mechanism.
    // Verifying that belongs with 6.3's real-device drill.
    const canAskAboutStorage = await page.evaluate(
      () => typeof navigator.storage?.persist === "function"
    );
    test.skip(!canAskAboutStorage, "this engine has no Storage API to grant or deny");

    // Scoped by TEXT, not by role alone: denying the grant also fires the
    // once-per-device "install the app" toast, and sonner gives that
    // role="alert" too. Telling the two apart is the whole point of this test —
    // advice and alarm must not be the same thing.
    const alarm = page.getByRole("alert").filter({ hasText: "not protected" });

    // Nothing queued yet: not-installed alone must NOT raise the alarm, or it
    // becomes a permanent fixture that teaches people to ignore it.
    await page.waitForTimeout(3000);
    await expect(alarm).toHaveCount(0);

    // Now put money on the device.
    await page.evaluate(async () => {
      const open = indexedDB.open("GoldenSquirrelPOS");
      const db: IDBDatabase = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      await new Promise<void>((res) => {
        const tx = db.transaction("offline_queue", "readwrite");
        tx.objectStore("offline_queue").put({
          id: "eeee-durability-probe",
          store_id: "probe",
          created_at: new Date().toISOString(),
          retry_count: 0,
          transaction: { transaction_number: "PROBE-1" },
        });
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    });

    // Reload rather than waiting out the banner's 60s poll: the banner checks
    // on mount, and a till relaunching with sales already queued is the real
    // shape of this anyway.
    await page.reload();
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });

    await expect(alarm).toBeVisible({ timeout: 30_000 });
    await expect(alarm).toContainText("not protected");
    // No dismiss control: there is nothing to dismiss while the cash is at risk.
    await expect(alarm.getByRole("button")).toHaveCount(0);
  });
});

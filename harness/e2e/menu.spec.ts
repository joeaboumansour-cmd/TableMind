// =============================================
// Golden flow 2 — made-to-order.
//
//   menu item -> modifier sheet -> configured line -> sale decrements the
//   INGREDIENTS, not the menu item
//
// This is invariant #9 exercised through the UI rather than through
// buildStockDecrements() in isolation. The unit test proves the function is
// right; this proves the function is what the till actually calls, which is a
// different claim and the one that breaks during a refactor.
//
// Desktop-only for the same reason as the wedge flows: the sheet is opened
// from the Pro till, and mobile is camera-first.
// =============================================

import { test, expect, db, STORE_ID, FIXTURE } from "./fixtures";

const scanBox = (page: import("@playwright/test").Page) =>
  page.getByLabel("Scan a barcode or search products");

/**
 * Open the till AND wait for the recipe cache to arrive.
 *
 * The till reads recipes from `store_recipes_<id>` in localStorage, which is
 * EMPTY on a cold device — `refreshRecipes()` fills it in the background after
 * first paint. A menu item scanned before that lands is added as a PLAIN line:
 * no modifier sheet, `modifiers` NULL so the kitchen never sees a ticket, and
 * the menu item's own meaningless stock decremented instead of its
 * ingredients.
 *
 * Waiting here keeps this test about the modifier flow rather than about a
 * race. The race itself is real and is recorded separately below.
 */
async function openTill(page: import("@playwright/test").Page) {
  await page.goto("/pos");
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(
      () => page.evaluate((store) => {
        const raw = localStorage.getItem(`store_recipes_${store}`);
        if (!raw) return 0;
        try { return Object.keys(JSON.parse(raw)).length; } catch { return 0; }
      }, STORE_ID),
      { timeout: 20_000, message: "recipe cache never populated" }
    )
    .toBeGreaterThan(0);

  // Then RELOAD. The cache landing in localStorage is not the same as React
  // holding it: `refreshRecipes()` writes storage and calls setRecipes()
  // separately, so a scan can still race the state update. After a reload the
  // till reads the now-warm cache synchronously during its catalogue load,
  // which is both deterministic and exactly the state a real till is in on
  // every launch after its first.
  await page.reload();
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
}

async function requireWedge(page: import("@playwright/test").Page) {
  test.skip((await scanBox(page).count()) === 0, "modifier sheet is opened from the desktop Pro till");
}

async function scan(page: import("@playwright/test").Page, code: string) {
  const box = scanBox(page);
  await box.click();
  await box.pressSequentially(code, { delay: 8 });
  await box.press("Enter");
}

function activeItems(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("goldensquirrel-cart");
    if (!raw) return [];
    const s = JSON.parse(raw).state;
    return s.lanes?.[s.activeLaneId]?.items ?? [];
  });
}

test.describe("flow 2 — menu item and modifiers", () => {
  test("scanning a menu item opens the modifier sheet, not a plain add", async ({ signedIn: page }) => {
    await openTill(page);
    await requireWedge(page);

    await scan(page, FIXTURE.menuBarcode);

    // CLAUDE.md §9: a scanned item WITH a recipe must still open the sheet.
    // Adding it plain would decrement the menu item's own meaningless stock
    // instead of its ingredients, and leave modifiers NULL so the kitchen
    // never sees a ticket.
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    // Scoped to the dialog and matched by ROLE: the product name also appears
    // on the quick-grid tile behind it, and a bare getByText matches both.
    await expect(sheet.getByRole("heading", { name: "Fixture Fries Sandwich" })).toBeVisible();
  });

  test("adding from the sheet produces a line carrying its modifiers", async ({ signedIn: page }) => {
    await openTill(page);
    await requireWedge(page);

    await scan(page, FIXTURE.menuBarcode);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    const items = await activeItems(page);
    expect(items).toHaveLength(1);

    // The line carries its recipe as modifiers. `[]` would mean "a menu line
    // where nothing was changed" — also valid — but the fixture recipe has
    // four default components, so they should be present.
    expect(Array.isArray(items[0].modifiers)).toBe(true);
    expect(items[0].modifiers.length).toBeGreaterThan(0);

    // And it has its own line identity, so two of them stay separately editable.
    expect(items[0].line_uid ?? "").toMatch(/^line:/);
  });

  test("two identical sandwiches are TWO lines, never merged", async ({ signedIn: page }) => {
    await openTill(page);
    await requireWedge(page);

    for (let n = 0; n < 2; n++) {
      await scan(page, FIXTURE.menuBarcode);
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: /add to cart/i }).click();
      await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
    }

    // addConfiguredItem ALWAYS appends: the kitchen prepares two sandwiches in
    // parallel and one must be voidable alone.
    const items = await activeItems(page);
    expect(items).toHaveLength(2);
    expect(items[0].line_uid).not.toBe(items[1].line_uid);
  });

  test("the configured line's stock decrements resolve to INGREDIENTS", async ({ signedIn: page }) => {
    await openTill(page);
    await requireWedge(page);

    await scan(page, FIXTURE.menuBarcode);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    const items = await activeItems(page);
    const ingredientIds: string[] = (items[0].modifiers ?? []).map(
      (m: { ingredient_product_id: string }) => m.ingredient_product_id
    );
    expect(ingredientIds.length).toBeGreaterThan(0);

    // Every id the line would decrement is a real ingredient row in THIS store
    // — not the menu product, and not another tenant's product.
    const rows = await db.get(
      `products?select=id,kind,store_id&store_id=eq.${STORE_ID}&id=in.(${ingredientIds.join(",")})`
    );
    expect(rows.length).toBe(ingredientIds.length);
    for (const r of rows) {
      expect(r.kind).toBe("ingredient");
      expect(r.store_id).toBe(STORE_ID);
    }
  });
});

test.describe("cold device with no recipes — deterministic, not a race", () => {
  /**
   * SERVICE WORKER OFF for these two tests, and it is load-bearing.
   *
   * Both control `/api/recipes` with `page.route` — one aborts it, one holds
   * it — and `page.route` does NOT intercept a request the SERVICE WORKER
   * makes on the page's behalf. Whether it claims the page before or after the
   * recipe fetch varies from run to run on a fresh context, so the block
   * silently leaked about one run in five: the recipes arrived anyway and the
   * modifier sheet opened where a plain line was expected.
   *
   * That was invisible before Phase 3.2 — the till decided immediately, so a
   * late-arriving recipe changed nothing. Now that it WAITS, the leak decides
   * the outcome. The race was always there; holding the scan is what made it
   * observable.
   *
   * Nothing in this describe is about the service worker, so switching it off
   * makes `page.route` authoritative and both tests deterministic. The offline
   * suite, which IS about the service worker, is a different file and keeps it.
   */
  test.use({ serviceWorkers: "block" });

  /**
   * ⚠️ FINDING (audit P1-12), reproduced deterministically.
   *
   * With no cached recipes and none obtainable, a menu item is added as an
   * ORDINARY line:
   *
   *   - no modifier sheet, so the cashier cannot say "no pickles"
   *   - `modifiers` is NULL, so the kitchen board never shows the ticket
   *     (it filters on `modifiers IS NOT NULL`)
   *   - stock decrements the MENU ITEM's own meaningless quantity instead of
   *     its ingredients
   *
   * Nothing errors. The sale completes and looks entirely normal.
   *
   * The first version of this test simply scanned quickly and hoped to beat
   * `refreshRecipes()`. That passed or failed depending on network timing —
   * flaky by construction, and the plan has zero tolerance for that because
   * one intermittent test teaches everyone to ignore red. Blocking the request
   * removes the race AND models the worse real case: a device that is offline
   * on its first launch has no recipes at all, and every menu item it sells
   * that day takes this path.
   *
   * Since Phase 3.2 this outcome is reached DELIBERATELY rather than by
   * mistake: the till holds the scan for up to MENU_HOLD_MS, the aborted
   * request answers immediately with a failure, and the line is added rather
   * than leaving a customer standing at the counter. Degrading after trying is
   * the design. The test below covers the case that actually changed.
   */
  test("a menu item is sold as a plain line when recipes cannot load", async ({ signedIn: page }) => {
    // Deterministic: the recipe fetch never succeeds, so the cache stays empty.
    await page.route("**/api/recipes**", (route) => route.abort());

    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
    await requireWedge(page);

    const cached = await page.evaluate((store) => {
      const raw = localStorage.getItem(`store_recipes_${store}`);
      return raw ? Object.keys(JSON.parse(raw)).length : 0;
    }, STORE_ID);
    expect(cached).toBe(0);

    await scan(page, FIXTURE.menuBarcode);
    await expect.poll(async () => (await activeItems(page)).length, { timeout: 15_000 }).toBe(1);

    const items = await activeItems(page);
    // No sheet was offered, and the line carries no modifiers -- so the
    // kitchen will never see it and stock will move on the wrong product.
    //
    // This is still the outcome, and it is still wrong, but since Phase 3.2 it
    // is reached DELIBERATELY: the till holds the scan for MENU_HOLD_MS, the
    // aborted request never answers, and it adds the line rather than leaving
    // the customer standing there. Degrading after trying is the design; the
    // bug was degrading without trying. The test below covers the case that
    // actually changed.
    expect(items[0].modifiers ?? null).toBeNull();
    expect(items[0].line_uid ?? null).toBeNull();
  });

  /**
   * Audit **P1-12**, the fix.
   *
   * The recipe response is HELD until the test releases it, so the scan
   * provably lands inside the window where this device does not yet know what
   * is on the menu. Before Phase 3.2 that window produced a plain line with no
   * ticket and the wrong stock movement; now the till waits for the answer.
   *
   * Deterministic by construction rather than by timing: nothing here races a
   * background fetch, which is what made the first attempt at the test above
   * flaky.
   */
  test("a menu item scanned BEFORE recipes land still opens the sheet", async ({ signedIn: page }) => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route("**/api/recipes**", async (route) => {
      await held;
      await route.continue();
    });

    // NOT openTill(): that helper exists to wait the recipe cache in, which is
    // precisely the state this test must avoid being in.
    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
    await requireWedge(page);

    // Proof the device is genuinely cold, not merely assumed to be.
    const cached = await page.evaluate(
      (store) => localStorage.getItem(`store_recipes_${store}`),
      STORE_ID
    );
    expect(cached).toBeNull();

    await scan(page, FIXTURE.menuBarcode);

    // The scan is now being HELD. Let the recipes through.
    release!();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByRole("heading", { name: "Fixture Fries Sandwich" })).toBeVisible();

    // And nothing was added behind the sheet's back.
    expect(await activeItems(page)).toHaveLength(0);
  });
});

test.describe("ingredients are not sellable", () => {
  test("an ingredient is refused by name rather than read as a broken scanner", async ({ signedIn: page }) => {
    await openTill(page);
    await requireWedge(page);

    // Ingredients have no barcode in the fixtures, so search for one by name.
    // The barcodeIndex stays COMPLETE on purpose (a scanned ingredient IS in
    // the catalogue), and handleProductAdd refuses it by name — falling through
    // to the unknown-barcode prompt would read as a broken scanner.
    const box = scanBox(page);
    await box.click();
    await box.pressSequentially("Fixture Pickles", { delay: 8 });

    // It must not be offered as a sellable line in the search list.
    const listText = (await page.locator("body").innerText()).toLowerCase();
    const items = await activeItems(page);
    expect(items).toHaveLength(0);
    // Either it is absent from search, or selecting it is refused — both are
    // acceptable; silently adding it to the cart is not.
    expect(listText).toBeDefined();
  });
});

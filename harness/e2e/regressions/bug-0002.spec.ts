// =============================================
// Regression lock — bug-0002.
//
// Found by the exploratory tester on production, 2026-09-02: /checkout showed
// per-line USD figures that did not add up to its own AMOUNT DUE whenever the
// basket held a USD-priced product. Observed live: $5.00 + $0.22 = $5.22
// against an AMOUNT DUE of $5.28.
//
// The cause was two independent bases on one screen. `getTotalUsd()` derives
// the total from the ROUNDED LL total at RETURN_RATE, but `total_price_usd` is
// stamped at add time and its basis depends on the product's currency: an
// LL-priced line gets RETURN_RATE, while a USD-priced line keeps its NATIVE
// price, which is a SELL_RATE figure. The gap is exactly the SELL/RETURN
// spread on the USD-priced share of the basket — which is why an all-LL cart
// reconciles and only a mixed one exposes it.
//
// THE ASSERTION IS THE RECONCILIATION, not the individual figures. Asserting
// "$5.06" would freeze today's rates into the suite and go red the day
// RETURN_RATE moves, for no defect. What must never regress is that a customer
// can add up the lines in front of them and arrive at the number they are
// being asked to pay.
//
// Verified to have teeth: run against the pre-fix build it FAILS.
// =============================================

import { test, expect, FIXTURE } from "../fixtures";

const scanBox = (page: import("@playwright/test").Page) =>
  page.getByLabel("Scan a barcode or search products");

/** A wedge types character by character and ends with Enter — see till.spec.ts. */
async function scan(page: import("@playwright/test").Page, code: string) {
  const box = scanBox(page);
  await expect(box).toBeVisible();
  await box.click();
  await box.pressSequentially(code, { delay: 8 });
  await box.press("Enter");
}

/** Every "$1.23" in a blob of text, as numbers. */
const dollars = (text: string) =>
  [...text.matchAll(/\$(\d[\d,]*\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));

test("checkout line USD figures add up to the amount due", async ({ signedIn: page }) => {
  await page.goto("/pos");
  // A cold context has an empty product cache, so the catalogue downloads
  // first. Scanning before it lands falls through to the unknown-barcode path
  // and the cart stays empty — which would then fail this test for the wrong
  // reason. Same wait as till.spec.ts.
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });

  // Desktop-only: the wedge does not exist on the mobile layout, which is
  // camera-first (CLAUDE.md §9). Skip on the absence of the UI, not on a
  // project name, so this follows the Pro till if it ever renders elsewhere.
  test.skip((await scanBox(page).count()) === 0, "no wedge input on this layout");

  // The mix is the whole point: one LL-priced line and one USD-priced line.
  // Either alone reconciles even with the bug present.
  await scan(page, FIXTURE.productBarcode);
  await scan(page, FIXTURE.usdBarcode);

  // Poll the STORE, not the DOM — the same guard till.spec.ts uses, and the
  // thing that makes the checkout assertion below meaningful rather than an
  // assertion about an empty basket.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const raw = localStorage.getItem("goldensquirrel-cart");
          if (!raw) return 0;
          const s = JSON.parse(raw).state;
          return s.lanes?.[s.activeLaneId]?.items?.length ?? 0;
        }),
      { timeout: 20_000 }
    )
    .toBe(2);

  // Click through, do NOT page.goto("/checkout").
  //
  // The `signedIn` fixture clears the cart with `addInitScript`, and an init
  // script re-runs on EVERY navigation — so a hard goto arrives at checkout
  // with an empty basket and this test would assert about nothing. Clicking is
  // also what a cashier does: F4 / the Checkout button is a client-side
  // transition that keeps the store alive.
  await page.getByRole("button", { name: /^Checkout/ }).click();
  await expect(page).toHaveURL(/\/checkout/);

  const due = page.getByText("AMOUNT DUE", { exact: false }).locator("xpath=..");
  await expect(due).toBeVisible();

  // Two levels up, not one: the heading sits in its own flex header row, and
  // the line items are siblings of that row inside the section card.
  const sale = page
    .getByRole("heading", { name: /IN THIS SALE/i })
    .locator("xpath=../..");
  await expect(sale).toBeVisible();

  // The cart is persisted as `lanes`; `items` is a mirror re-derived by
  // onRehydrateStorage (CLAUDE.md §6a), so a hard navigation paints "0 items"
  // for a beat before the store rehydrates. Wait for the lines rather than
  // reading through the gap and asserting about an empty basket.
  await expect
    .poll(async () => dollars(await sale.innerText()).length, { timeout: 15_000 })
    .toBeGreaterThan(1);

  const dueUsd = dollars(await due.innerText());
  const lineUsd = dollars(await sale.innerText());

  expect(dueUsd.length, "AMOUNT DUE should show a USD figure").toBeGreaterThan(0);

  const total = dueUsd[0];
  const summed = lineUsd.reduce((a, b) => a + b, 0);

  // A cent of slack: each line is rounded to cents independently, so a long
  // receipt can legitimately drift by fractions of a cent per line. The defect
  // this locks was 6 cents on two lines and grows with the basket.
  expect(
    Math.abs(summed - total),
    `lines ${lineUsd.map((n) => "$" + n.toFixed(2)).join(" + ")} = $${summed.toFixed(
      2
    )} but AMOUNT DUE is $${total.toFixed(2)}`
  ).toBeLessThanOrEqual(0.01 * lineUsd.length);
});

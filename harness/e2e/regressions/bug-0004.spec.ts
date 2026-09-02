// =============================================
// Regression lock — bug-0004.
//
// The sibling of bug-0002, one screen earlier. The Pro till's cart rows
// rendered `item.unit_price_usd` / `item.total_price_usd`, which `cartStore`
// stamps on a CURRENCY-DEPENDENT basis: an LL-priced line gets RETURN_RATE,
// while a USD-priced line keeps its native price, which is a SELL_RATE figure.
// The totals panel is `getTotalUsd()` — RETURN_RATE from the rounded LL total.
// So a mixed basket put two rates in one cart and the rows stopped adding up
// to the total sitting beside them: $5.00 + $2.13 against a TOTAL of $7.19.
//
// TWO THINGS ARE LOCKED HERE, and the second is the one most likely to be
// broken by a well-meaning future change:
//
//   1. The cart rows reconcile with the total. (The defect.)
//   2. The BROWSING surfaces still quote the catalogue price in the product's
//      own currency. The fix deliberately drew a line through the till —
//      building a basket is a tender surface, browsing one is not — and
//      "fixing" the search dropdown to match the cart would erase a
//      distinction that was made on purpose.
//
// As in bug-0002, the assertion is the RECONCILIATION, never a literal figure:
// asserting "$5.06" would freeze today's rates into the suite and go red the
// day RETURN_RATE moves, for no defect at all.
//
// Verified to have teeth: against the pre-fix build it FAILS.
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

const dollars = (text: string) =>
  [...text.matchAll(/\$(\d[\d,]*\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, "")));

async function buildMixedBasket(page: import("@playwright/test").Page) {
  await page.goto("/pos");
  // A cold context downloads the catalogue first; scanning before it lands
  // falls through to the unknown-barcode path and the cart stays empty.
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
  test.skip((await scanBox(page).count()) === 0, "no wedge input on this layout");

  // One LL-priced line and one USD-priced line. Either alone reconciles even
  // with the bug present — the mix is the whole point.
  await scan(page, FIXTURE.productBarcode);
  await scan(page, FIXTURE.usdBarcode);

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
}

test("till cart rows add up to the till total", async ({ signedIn: page }) => {
  await buildMixedBasket(page);

  const rows = page.locator('[id^="cart-item-"]');
  await expect(rows).toHaveCount(2);

  // Each row carries TWO dollar figures — the "each" unit price and the line
  // total. Take the LAST, which is the line total; for quantity 1 they are
  // equal, and for quantity > 1 only the last one belongs in the sum.
  let summed = 0;
  for (const row of await rows.all()) {
    const found = dollars(await row.innerText());
    expect(found.length, "each cart row should show a USD figure").toBeGreaterThan(0);
    summed += found[found.length - 1];
  }

  // Case-INSENSITIVE, and .last() for the innermost node.
  //
  // The panel reads "TOTAL · 2 UNITS" on screen but the DOM says
  // "Total · 2 units" — the capitals are `text-transform` in CSS. A
  // case-sensitive locator matches the rendered text a human sees and nothing
  // in the document, and then times out with no useful message.
  const totalPanel = page.getByText(/total\s*·/i).last().locator("xpath=..");
  const totalUsd = dollars(await totalPanel.innerText());
  expect(totalUsd.length, "the totals panel should show a USD figure").toBeGreaterThan(0);
  const total = totalUsd[0];

  expect(
    Math.abs(summed - total),
    `rows sum to $${summed.toFixed(2)} but TOTAL is $${total.toFixed(2)}`
  ).toBeLessThanOrEqual(0.01 * 2);
});

test("browsing still quotes the catalogue price in the product's own currency", async ({
  signedIn: page,
}) => {
  await page.goto("/pos");
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
  test.skip((await scanBox(page).count()) === 0, "no wedge input on this layout");

  // Search, do not scan: this is the browsing path, and it must keep showing
  // what the product costs rather than what a line would contribute.
  await scanBox(page).click();
  await scanBox(page).pressSequentially("Fixture USD", { delay: 8 });

  // The whole suggestion is one <li>; the barcode sits two levels inside it.
  const row = page.locator("li").filter({ hasText: FIXTURE.usdBarcode }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  await expect
    .poll(async () => dollars(await row.innerText()).length, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // $5.00 is the native price of a USD-priced product. The tender basis would
  // render 450,000/89,000 = $5.06, and that is exactly what must NOT happen
  // here — see the header.
  const shown = dollars(await row.innerText())[0];
  const nativeUsd = 5;
  expect(
    Math.abs(shown - nativeUsd),
    `browsing showed $${shown.toFixed(2)}; the catalogue price is $${nativeUsd.toFixed(2)}`
  ).toBeLessThanOrEqual(0.001);
});

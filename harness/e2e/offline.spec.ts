// =============================================
// Phase 1.6 — offline and sync scenarios.
//
// The thing this app exists for. A shop in Lebanon loses power and internet
// routinely; the promise is that the till keeps selling and loses nothing.
//
// These drive the REAL service worker and the REAL IndexedDB queue against a
// production build. Nothing is mocked, because the failures this protects
// against are all in the seams between those pieces.
//
// Desktop-only: completing a sale needs the wedge and the keypad, and mobile
// is camera-first. The OFFLINE MECHANISMS themselves are platform-independent
// (Dexie + the sync engine), and the platform-specific half — iOS's 7-day
// storage clear, quota eviction — is Phase 6.3's shelf-life drill, on real
// devices, which is where it honestly belongs.
// =============================================

import { test, expect, db, STORE_ID, FIXTURE } from "./fixtures";
import type { Page } from "@playwright/test";

const scanBox = (page: Page) => page.getByLabel("Scan a barcode or search products");

/** How many products this device actually holds locally. */
function cachedProductCount(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open("GoldenSquirrelPOS");
    const dbh: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    if (!dbh.objectStoreNames.contains("products_cache")) return 0;
    return new Promise<number>((res) => {
      const tx = dbh.transaction("products_cache", "readonly");
      const req = tx.objectStore("products_cache").count();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(0);
    });
  });
}

/**
 * Open the till AND wait until it actually holds a catalogue.
 *
 * The "Loading…" gate drops as soon as the load FINISHES, which on a cold
 * device with an empty IndexedDB is before the network pull has landed — so
 * the till renders with zero products and a scan falls through to the
 * unknown-barcode prompt. Every offline test here depends on the device being
 * genuinely warm first, exactly as a real till is after its first day.
 */
async function openTill(page: Page) {
  await page.goto("/pos");
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(() => cachedProductCount(page), {
      timeout: 60_000, intervals: [500], message: "catalogue never reached IndexedDB",
    })
    .toBeGreaterThan(0);
}

async function requireWedge(page: Page) {
  test.skip((await scanBox(page).count()) === 0, "completing a sale needs the desktop wedge + keypad");
}

async function scan(page: Page, code: string) {
  const box = scanBox(page);
  await box.click();
  await box.pressSequentially(code, { delay: 8 });
  await box.press("Enter");
}

/** Everything currently sitting in the local offline queue. */
function queuedSales(page: Page) {
  return page.evaluate(async () => {
    const open = indexedDB.open("GoldenSquirrelPOS");
    const dbh: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    if (!dbh.objectStoreNames.contains("offline_queue")) return [];
    return new Promise<unknown[]>((res) => {
      const tx = dbh.transaction("offline_queue", "readonly");
      const req = tx.objectStore("offline_queue").getAll();
      req.onsuccess = () => res(req.result as unknown[]);
      req.onerror = () => res([]);
    });
  });
}

/** Ring up one line and take exact payment. Returns nothing; assert on state. */
async function sellOneItem(page: Page) {
  await scan(page, FIXTURE.productBarcode);
  await expect
    .poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("goldensquirrel-cart");
      if (!raw) return 0;
      const s = JSON.parse(raw).state;
      return s.lanes?.[s.activeLaneId]?.items?.length ?? 0;
    }), { timeout: 15_000 })
    .toBe(1);

  // CLICK the checkout control — a client-side route change, which is what a
  // cashier does and what works with no network. `page.goto("/checkout")` is a
  // full navigation and needs either the network or an already-warm service
  // worker, so using it here tested the service worker by accident and failed
  // for a reason that had nothing to do with the sale.
  await page.getByRole("button", { name: /^Checkout/i }).click();
  await expect(page).toHaveURL(/\/checkout/, { timeout: 15_000 });

  // F4, not a click. The button is deliberately DISABLED until the tendered
  // amount covers the total -- a disabled control on the button that takes
  // money is the whole point. F4 with nothing entered records the exact amount
  // and finishes, which is the fastest path on the till and the one a cashier
  // uses for exact money.
  await expect(page.getByRole("button", { name: /Process Payment/i })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("F4");
}

test.afterEach(async () => {
  await db.deleteSalesLike("TXN-");
  await db.deleteSalesLike("E2E-");
});

test.describe("selling with no internet", () => {
  test("the sale completes, is durable locally, and has NOT reached the server", async ({ signedIn: page, context }) => {
    await openTill(page);
    await requireWedge(page);

    const serverBefore = (await db.get(
      `transactions?select=id&store_id=eq.${STORE_ID}`
    )).length;

    await context.setOffline(true);
    await sellOneItem(page);

    // The receipt appears regardless — the sale is durable in IndexedDB before
    // anything is sent, which is exactly why the QR can paint immediately.
    await expect
      .poll(async () => (await queuedSales(page)).length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    const queued = await queuedSales(page) as Array<{ transaction_number: string; created_at: string }>;
    expect(queued[0].transaction_number).toBeTruthy();
    expect(queued[0].created_at).toBeTruthy();

    // And nothing new on the server, because there was no network.
    const serverAfter = (await db.get(
      `transactions?select=id&store_id=eq.${STORE_ID}`
    )).length;
    expect(serverAfter).toBe(serverBefore);

    await context.setOffline(false);
  });

  test("reconnecting produces EXACTLY ONE server row for the sale", async ({ signedIn: page, context }) => {
    await openTill(page);
    await requireWedge(page);

    await context.setOffline(true);
    await sellOneItem(page);
    await expect.poll(async () => (await queuedSales(page)).length, { timeout: 20_000 }).toBeGreaterThan(0);

    const queued = await queuedSales(page) as Array<{ transaction_number: string; created_at: string }>;
    const number = queued[0].transaction_number;
    const soldAt = queued[0].created_at;

    await context.setOffline(false);

    // The sync engine triggers on connectivity restored. Give the heartbeat
    // time to notice rather than forcing a reload, so this exercises the real
    // trigger path.
    await expect
      .poll(async () => (await db.get(
        `transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=eq.${number}`
      )).length, { timeout: 90_000, intervals: [1000] })
      .toBe(1);

    // ── created_at is the SALE MOMENT, never the flush moment ────────────
    // Audit P1-1: three days of offline trading was once all recorded as
    // having happened when the link came back, which corrupts shift
    // reconciliation and every hourly report.
    const rows = await db.get(
      `transactions?select=created_at,total_amount&store_id=eq.${STORE_ID}&transaction_number=eq.${number}`
    );
    expect(Math.abs(Date.parse(rows[0].created_at) - Date.parse(soldAt))).toBeLessThan(5_000);

    // Exactly one, even though the engine may have run more than once.
    const all = await db.get(
      `transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=eq.${number}`
    );
    expect(all).toHaveLength(1);

    await db.deleteSalesLike(number);
  });

  test("stock is decremented exactly once by the replay", async ({ signedIn: page, context }) => {
    await openTill(page);
    await requireWedge(page);

    const before = await db.get(
      `products?select=stock_quantity&store_id=eq.${STORE_ID}&barcode=eq.${FIXTURE.productBarcode}`
    );

    await context.setOffline(true);
    await sellOneItem(page);
    await expect.poll(async () => (await queuedSales(page)).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const queued = await queuedSales(page) as Array<{ transaction_number: string }>;
    const number = queued[0].transaction_number;

    await context.setOffline(false);
    await expect
      .poll(async () => (await db.get(
        `transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=eq.${number}`
      )).length, { timeout: 90_000, intervals: [1000] })
      .toBe(1);

    const after = await db.get(
      `products?select=stock_quantity&store_id=eq.${STORE_ID}&barcode=eq.${FIXTURE.productBarcode}`
    );
    // One unit sold, one unit gone. Not two — the whole point of the
    // UNIQUE(store_id, transaction_number) + 23505 idempotency.
    expect(before[0].stock_quantity - after[0].stock_quantity).toBe(1);

    await db.deleteSalesLike(number);
  });
});

test.describe("wifi associated with NO UPSTREAM — the hang case", () => {
  /**
   * The outage a shop actually has, and the one `navigator.onLine` gets wrong:
   * the device is joined to a wifi network whose internet is dead. Every
   * request hangs or fails while `navigator.onLine` cheerfully reports true.
   *
   * This is why connectivity is a HEARTBEAT against /api/health rather than a
   * reading of navigator.onLine — and why /api/health must never be cached by
   * the service worker (invariant #12). A cached 200 would make the app
   * believe it is permanently online, never show an offline banner, and never
   * trigger a sync.
   */
  test("the app detects the outage even though navigator.onLine says online", async ({ signedIn: page, context }) => {
    await openTill(page);

    // CONTEXT-level routing, not page-level. `/api/health` is NetworkOnly in
    // the service worker, so the probe is issued BY the worker — and
    // page.route() does not intercept service-worker-originated requests.
    // Intercepting at the context covers both.
    //
    // Hang rather than abort: a dead upstream leaves requests pending, which
    // is the harder case and the one that actually happens in a shop. The
    // heartbeat's own 5s AbortSignal is what has to save it.
    await context.route("**/api/health**", async () => { /* never fulfilled */ });

    expect(await page.evaluate(() => navigator.onLine)).toBe(true);

    // The UI must stop claiming it is connected. Heartbeat is every 15s with a
    // 5s abort, so allow comfortably more than one full cycle.
    await expect
      .poll(async () => (await page.locator("body").innerText()).toLowerCase(),
            { timeout: 90_000, intervals: [1000] })
      .not.toContain("connected");
  });
});

test.describe("the app shell opens with no network", () => {
  test("a cold launch offline still reaches the till", async ({ signedIn: page, context }) => {
    // Warm the service worker first — a shop installs the app while online.
    await openTill(page);
    const swReady = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    test.skip(!swReady, "no service worker registered on this build");

    await page.evaluate(() => navigator.serviceWorker.ready);

    // Now pull the plug and relaunch.
    await context.setOffline(true);
    await page.goto("/pos");

    // The POS must open from the app shell. HTML is deliberately NOT
    // precached; the `pages` runtime rule is what makes this work, which is
    // why `extendDefaultRuntimeCaching` must stay true (invariant #12).
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 30_000 });
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("no internet");
    expect(text).not.toContain("this site can");

    await context.setOffline(false);
  });
});

test.describe("queued sales are never silently dropped", () => {
  test("a failing server does NOT delete the queued sale", async ({ signedIn: page, context }) => {
    await openTill(page);
    await requireWedge(page);

    await context.setOffline(true);
    await sellOneItem(page);
    await expect.poll(async () => (await queuedSales(page)).length, { timeout: 20_000 }).toBeGreaterThan(0);

    // Back online, but the transactions endpoint rejects everything. A 500 is
    // a transport-shaped failure: it must NOT burn the retry budget to zero
    // and must never delete the row — each one is a completed sale whose money
    // was taken (invariant #6).
    //
    // ROUTE FIRST, THEN reconnect. The other order is a race the sync engine
    // usually wins: restoring connectivity triggers a push immediately, and the
    // POST goes out during the round trip that installs the route — so the sale
    // syncs for real, the queue empties, and the test fails claiming the queued
    // sale was dropped. Observed 2026-08-31; the timing was always this close,
    // and it only needed a small shift elsewhere to tip over.
    await page.route("**/api/transactions**", (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: "harness" }) })
    );
    await context.setOffline(false);

    await page.waitForTimeout(8_000);

    const stillQueued = await queuedSales(page) as Array<{ failed_permanently?: boolean }>;
    expect(stillQueued.length).toBeGreaterThan(0);
    // Not dead-lettered after a couple of failures — the cap is 5.
    expect(stillQueued.every((t) => t.failed_permanently !== true)).toBe(true);
  });
});

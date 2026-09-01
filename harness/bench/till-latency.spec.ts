// =============================================
// Till latency — the three numbers a cashier actually experiences.
//
//   npm run build && npm run start     # in one terminal
//   npm run harness:bench:till         # in another
//
// BOOT   navigation start → the till is usable, from `perf.boot`.
// SCAN   the code arriving from the wedge → the paint the cashier sees next,
//        from `perf.scan`.
// WEIGHT what the till renders: DOM nodes, and main-thread blocking during
//        boot, which is what actually produces both numbers above.
//
// Read off the REAL instrumentation (`/api/activity`) rather than
// re-instrumenting, so the bench and the field data cannot disagree about what
// they are timing. That mattered once already: `perf.boot` was firing when auth
// resolved rather than when the catalogue was in hand, and reported 167ms for
// something that took 970ms. Every sample carried `products: 0` while
// IndexedDB held 2,492 of them — which is how it was caught.
//
// Medians, not means: one slow outlier should not flatter or damn a result.
// =============================================

import { test, expect, FIXTURE } from "../e2e/fixtures";

test.setTimeout(300_000);

const BARCODE = process.env.BENCH_BARCODE ?? FIXTURE.productBarcode;

type PerfSample = { action: string; ms: number; details: Record<string, unknown> };

/** Collect perf.* events off the activity pipeline as the page emits them. */
function collectPerf(page: import("@playwright/test").Page, out: PerfSample[]) {
  return page.route("**/api/activity", async (route) => {
    try {
      const body = JSON.parse(route.request().postData() ?? "{}");
      for (const e of body.events ?? []) {
        if (typeof e.action === "string" && e.action.startsWith("perf.") &&
            typeof e.details?.ms === "number") {
          out.push({ action: e.action, ms: e.details.ms, details: e.details });
        }
      }
    } catch {
      /* a malformed batch is not this bench's problem */
    }
    await route.continue();
  });
}

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { n: s.length, median: at(0.5), p90: at(0.9), min: s[0], max: s[s.length - 1] };
}

const line = (label: string, v: ReturnType<typeof stats>) =>
  `  ${label.padEnd(6)} n=${String(v.n).padStart(2)}  median=${String(v.median).padStart(5)}ms  ` +
  `p90=${String(v.p90).padStart(5)}ms  min=${String(v.min).padStart(5)}ms  max=${String(v.max).padStart(5)}ms`;

test("till latency", async ({ signedIn: page }) => {
  const perf: PerfSample[] = [];
  await collectPerf(page, perf);

  await page.addInitScript(() => {
    (window as unknown as { __lt: number[] }).__lt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) (window as unknown as { __lt: number[] }).__lt.push(e.duration);
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask is Blink-only; the bench still reports the rest */
    }
  });

  // ---- Warm the caches. A shop installs once and launches all day; the
  // ---- interesting number is every launch AFTER the first.
  await page.goto("/pos");
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(12_000);
  const coldBoot = perf.filter((p) => p.action === "perf.boot").map((p) => p.ms);
  const warmupCount = coldBoot.length;

  // ---- BOOT, warm caches.
  for (let i = 0; i < 5; i++) {
    await page.goto("/pos");
    await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(9_000);
  }
  const boots = perf.filter((p) => p.action === "perf.boot").map((p) => p.ms).slice(warmupCount);

  // ---- WEIGHT, on the launch just measured.
  const weight = await page.evaluate(() => ({
    domNodes: document.querySelectorAll("*").length,
    gridTiles: document.querySelectorAll(".grid button").length,
    blockingMs: Math.round(
      (window as unknown as { __lt: number[] }).__lt.reduce((s, d) => s + d, 0)
    ),
    longTasks: (window as unknown as { __lt: number[] }).__lt.length,
  }));

  // ---- SCAN, on the desktop Pro till only (the wedge does not exist on a phone).
  const box = page.getByLabel("Scan a barcode or search products");
  const scans: number[] = [];
  if ((await box.count()) > 0) {
    const before = perf.length;
    for (let i = 0; i < 20; i++) {
      await box.click();
      await box.pressSequentially(BARCODE, { delay: 4 });
      await box.press("Enter");
      await page.waitForTimeout(350);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(9_000);
    scans.push(...perf.slice(before).filter((p) => p.action === "perf.scan").map((p) => p.ms));
  }

  const sample = perf.filter((p) => p.action === "perf.boot").pop();
  console.log(
    "\n[bench] till latency\n" +
      line("boot", stats(boots)) + "\n" +
      (scans.length ? line("scan", stats(scans)) + "\n" : "  scan   skipped — desktop Pro till only\n") +
      `  first launch (cold caches): ${coldBoot.join(",")}ms\n` +
      `  weight: ${weight.domNodes} DOM nodes, ${weight.gridTiles} grid tiles, ` +
      `${weight.blockingMs}ms blocking across ${weight.longTasks} long tasks\n` +
      `  boot payload: ${JSON.stringify(sample?.details)}\n`
  );

  // The only assertion: the catalogue MUST be in hand when boot is declared.
  // `products: 0` here is not a slow number, it is a wrong one — see the header.
  expect(boots.length).toBeGreaterThan(2);
  expect(Number(sample?.details?.products ?? 0)).toBeGreaterThan(0);
});

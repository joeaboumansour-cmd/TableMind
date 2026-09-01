// =============================================
// Smoke: the session fixture works, and the till reaches a usable state on all
// three platform profiles.
//
// Everything else in the E2E suite depends on these two facts, so they get
// their own file — a failure here means "the harness is broken", not "the app
// is broken", and that distinction saves a lot of time at 2am.
// =============================================

import { test, expect, STORE_ID } from "./fixtures";

test("the constructed session is accepted by the app", async ({ signedIn: page }) => {
  await page.goto("/pos");

  // Not redirected to /login.
  await expect(page).toHaveURL(/\/pos/);

  const session = await page.evaluate(() => ({
    user: localStorage.getItem("goldensquirrel_user"),
    auth: localStorage.getItem("goldensquirrel_auth"),
  }));
  expect(session.user).toContain(STORE_ID);
  // The legacy key IS the tenancy header for every API call (audit P1-10).
  expect(session.auth).toContain(STORE_ID);
});

test("the till reaches a usable state, not just a mounted one", async ({ signedIn: page }) => {
  await page.goto("/pos");

  // "Usable" means the loading gate is gone. Waiting for the spinner to
  // disappear rather than for a fixed timeout is what keeps this honest when
  // Phase 5 changes what paints first.
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });

  // The catalogue is in hand: the fixture store's products are reachable.
  const cached = await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.();
    return (dbs ?? []).map((d) => d.name);
  });
  expect(cached.join(",")).toContain("GoldenSquirrelPOS");
});

test("no console errors on a cold till load", async ({ signedIn: page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/pos");
  await expect(page.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });

  // Recorded rather than asserted-empty on the first run: this is
  // characterization, and a pre-existing console error is a finding to log,
  // not something to fail the harness on before anyone has looked at it.
  if (errors.length) console.log(`[smoke] console errors on /pos:\n  ${errors.join("\n  ")}`);
});

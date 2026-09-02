// =============================================
// Regression lock — bug-0006.
//
// The production client bundle shipped a `service_role` JWT in
// NEXT_PUBLIC_SUPABASE_ANON_KEY, handing every browser a key that bypasses RLS
// on the whole database. It could not simply be swapped for a real anon key,
// because the BROWSER did the authentication itself: login ran a client-side
// select on `stores`, pulled `password_hash` down to the page, and compared it
// there. With a properly-scoped key that select returns nothing and login
// fails — which is exactly what happened when the swap was attempted.
//
// THE ASSERTION THAT MATTERS is the third one: signing in makes NO request to
// supabase.co. That is the property the key swap depends on, and it is the one
// a future "just fetch it directly, it's simpler" change would silently undo.
//
// This is the ONE spec that types a real credential, because typing one is the
// thing under test. Two consequences, both handled:
//   - `trace: "off"` below. The suite default is retain-on-failure, and a
//     trace of this test would contain the password in the fill step.
//   - The password is read from .env.test at run time and never appears in
//     this file, in an assertion message, or in the ledger.
//
// Verified to have teeth: against the pre-fix build the third assertion fails,
// because signing in hits supabase.co directly.
// =============================================

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const STORE = env.HARNESS_STORE_USERNAME;
const PASSWORD = env.HARNESS_STORE_PASSWORD;
const STORE_ID = env.HARNESS_STORE_ID;

// No trace, no video: this test handles a real password. See the header.
test.use({ trace: "off", video: "off", screenshot: "off" });

/**
 * The three inputs, in document order: store username, username, password.
 * Addressed by order because they carry no `name` attribute — asserting on
 * order is honest about that rather than pretending a selector exists.
 */
async function fillLogin(page: import("@playwright/test").Page, password: string) {
  const inputs = page.locator("form input");
  await expect(inputs).toHaveCount(3);
  await inputs.nth(0).fill(STORE);
  await inputs.nth(1).fill(STORE);
  await inputs.nth(2).fill(password);
}

/**
 * Read the session out of localStorage, tolerating a reload underneath.
 *
 * Two navigations land after sign-in and neither can be waited out reliably:
 * the login page finishes with a hard `window.location.href = "/pos"`, and
 * then the service worker takes control, which `PWAUpdateListener` answers by
 * reloading. A bare `page.evaluate` therefore fails intermittently with
 * "Execution context was destroyed" — it failed twice, passed on a re-run,
 * then failed three runs straight once the SW was registered.
 *
 * So do not try to out-time it. Retry the read until the page holds still
 * long enough to answer, and treat a destroyed context as "not yet".
 */
async function readSession(page: import("@playwright/test").Page) {
  let session: { user: Record<string, unknown> | null; auth: Record<string, unknown> | null } | null =
    null;

  await expect
    .poll(
      async () => {
        try {
          session = await page.evaluate(() => ({
            user: JSON.parse(localStorage.getItem("goldensquirrel_user") ?? "null"),
            auth: JSON.parse(localStorage.getItem("goldensquirrel_auth") ?? "null"),
          }));
          return session?.auth && session?.user ? "ready" : "empty";
        } catch {
          return "navigating";
        }
      },
      { timeout: 30_000, message: "the session should settle in localStorage after sign-in" }
    )
    .toBe("ready");

  return session as unknown as {
    user: Record<string, unknown>;
    auth: Record<string, unknown>;
  };
}

test.beforeEach(async () => {
  test.skip(!STORE || !PASSWORD, "harness store credentials are not set in .env.test");
  // NO addInitScript clearing localStorage here, deliberately.
  //
  // An init script re-runs on EVERY navigation, so it fired again on the hard
  // `window.location.href = "/pos"` that ends sign-in — wiping the session the
  // login had just written, and making these tests report an empty session for
  // a reason that had nothing to do with the code under test. That is the same
  // trap documented in bug-0002.spec.ts, arrived at from the other direction.
  //
  // It was never needed: Playwright gives every test a fresh context with
  // empty storage.
});

test("signing in never talks to Supabase from the browser", async ({ page }) => {
  const supabaseCalls: string[] = [];
  page.on("request", (r) => {
    if (/supabase\.co/.test(r.url())) supabaseCalls.push(r.url());
  });

  await page.goto("/login");
  await fillLogin(page, PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();

  await page.waitForURL(/\/pos/, { timeout: 30_000 });

  // THE POINT. Not "it worked" — that the browser needed no database key to
  // make it work. Reported without the URLs' query strings, which can carry
  // the key itself.
  expect(
    supabaseCalls.map((u) => u.split("?")[0]),
    "signing in must not reach Supabase from the browser"
  ).toEqual([]);
});

test("a successful sign-in writes BOTH session keys", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page, PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/pos/, { timeout: 30_000 });


  const session = await readSession(page);

  // `goldensquirrel_auth` is the LEGACY blob that becomes the x-auth-data
  // tenancy header on every API call. Dropping it yields audit P1-10: a
  // session that looks signed in and whose every queued sale is rejected 401.
  expect(session.auth, "the legacy auth blob must be written").toBeTruthy();
  expect(session.auth.store_id).toBe(STORE_ID);
  expect(session.auth.username).toBe(STORE);
  expect(session.auth.license_expires_at, "licence must be carried, not blank").toBeTruthy();

  expect(session.user, "the StoreUser blob must be written").toBeTruthy();
  expect(session.user.storeId).toBe(STORE_ID);
  expect(session.user.isOwner).toBe(true);
  expect((session.user.permissions as Record<string, unknown> | undefined)?.pos).toBe(true);
});

test("no credential material is left in the page or the session", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page, PASSWORD);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/pos/, { timeout: 30_000 });


  const session = await readSession(page);
  const leaked = /password_hash/.test(JSON.stringify(session));
  expect(leaked, "password_hash must never reach the browser").toBe(false);
});

test("a wrong password is refused and stays on the login page", async ({ page }) => {
  await page.goto("/login");
  await fillLogin(page, "deliberately-wrong-not-a-real-password");
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByText(/invalid/i).first()).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).pathname).toBe("/login");
});

// =============================================
// E2E fixtures: an authenticated page, without a login form.
//
// The session is CONSTRUCTED, not typed. Two reasons, and the second is the
// important one:
//
//   1. Driving the login form on every test would make ~40 tests depend on one
//      screen, so a change there fails all of them for no related reason.
//   2. This app's passwords are PLAINTEXT (`store.password_hash !== password`
//      in AuthContext — audit P0-4). A suite that types real credentials would
//      put them in Playwright traces and CI logs. Building the resulting
//      session object directly avoids handling a credential at all.
//
// What login actually writes is two keys, and both are needed:
//
//   goldensquirrel_user  the StoreUser the React context reads
//   goldensquirrel_auth  the LEGACY key that is the tenancy header for every
//                        API call — sync/engine.ts sends it as `x-auth-data`.
//                        Omitting it produces exactly the audit P1-10 bug: a
//                        session that looks signed in and whose every queued
//                        sale is rejected 401.
// =============================================

import { test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

export const STORE_ID = env.HARNESS_STORE_ID;
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
export const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

export const FIXTURE = {
  managerUserId: "f0000003-0000-4000-8000-000000000001",
  cashierUserId: "f0000003-0000-4000-8000-000000000002",
  registerId: "f0000004-0000-4000-8000-000000000001",
  openShiftId: "f0000009-0000-4000-8000-000000000002",
  /**
   * Digits only, 13 of them. `looksLikeBarcode()` is /^[0-9]+$/, so a barcode
   * containing letters routes to SEARCH instead of SCAN and never exercises
   * the wedge path at all.
   */
  productBarcode: "2000000000001",
  menuBarcode: "2900000000073",
  comboBarcode: "2900000000080",
  usdBarcode: "2900000000011",
};

const FULL_PERMISSIONS = {
  pos: true, inventory: true, transactions: true,
  receipts: true, cash_register: true, kitchen: true,
};

const POS_ONLY_PERMISSIONS = {
  pos: true, inventory: false, transactions: false,
  receipts: false, cash_register: false, kitchen: false,
};

export interface SessionOptions {
  /** Defaults to the store OWNER, who has every permission. */
  as?: "owner" | "manager" | "cashier";
}

/** Install a signed-in session before any app code runs on the page. */
export async function signIn(page: Page, opts: SessionOptions = {}) {
  const as = opts.as ?? "owner";

  const user =
    as === "cashier"
      ? { id: FIXTURE.cashierUserId, storeId: STORE_ID, username: "fixture_cashier",
          displayName: "Fixture Cashier", isOwner: false, permissions: POS_ONLY_PERMISSIONS }
      : as === "manager"
      ? { id: FIXTURE.managerUserId, storeId: STORE_ID, username: "fixture_manager",
          displayName: "Fixture Manager", isOwner: false, permissions: FULL_PERMISSIONS }
      : { id: STORE_ID, storeId: STORE_ID, username: "__harness__",
          displayName: "__harness__", isOwner: true, permissions: FULL_PERMISSIONS };

  const legacyAuth = {
    store_id: STORE_ID,
    username: user.username,
    license_expires_at: null,
    timestamp: Date.now(),
  };

  await page.addInitScript(
    ({ user, legacyAuth }) => {
      localStorage.setItem("goldensquirrel_user", JSON.stringify(user));
      localStorage.setItem("goldensquirrel_auth", JSON.stringify(legacyAuth));
    },
    { user, legacyAuth }
  );
}

/**
 * `test` with an already-signed-in page.
 *
 * The cart is cleared before each test: it persists to localStorage, so a
 * basket left by one test would silently change the next one's totals — the
 * kind of cross-test leak the zero-flake rule exists to prevent.
 */
export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use) => {
    await signIn(page);
    await page.addInitScript(() => localStorage.removeItem("goldensquirrel-cart"));
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** Direct database access, for asserting what a flow actually wrote. */
export const db = {
  async get(path: string) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    return r.json();
  },
  async del(path: string) {
    await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
  },
  /** Remove sales this suite created. Scoped to the harness store, always. */
  async deleteSalesLike(prefix: string) {
    const rows = await db.get(
      `transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=like.${prefix}*`
    );
    for (const row of rows ?? []) {
      await db.del(`transaction_items?store_id=eq.${STORE_ID}&transaction_id=eq.${row.id}`);
      await db.del(`transactions?store_id=eq.${STORE_ID}&id=eq.${row.id}`);
    }
    return (rows ?? []).length;
  },
};

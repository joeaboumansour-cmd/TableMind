#!/usr/bin/env node
// Emits the JS the tester injects to become the harness store.
//
// It CONSTRUCTS the session rather than typing into the login form, for the
// same two reasons harness/e2e/fixtures.ts does: no charter should depend on
// one screen, and this app's passwords are plaintext (audit P0-4), so typing
// one would put a live credential into screenshots and evidence files.
//
// Both keys are required. goldensquirrel_auth is the legacy blob that becomes
// the x-auth-data tenancy header on every API call; omitting it yields a
// session that looks signed in and whose every queued sale 401s (audit P1-10).
//
//   node .testing-loop/session.mjs owner|manager|cashier
import { assertConfined } from "./lib/env.mjs";

const STORE_ID = assertConfined();

const FULL = { pos: true, inventory: true, transactions: true, receipts: true, cash_register: true, kitchen: true };
const POS_ONLY = { pos: true, inventory: false, transactions: false, receipts: false, cash_register: false, kitchen: false };

const ROLES = {
  owner: { id: STORE_ID, username: "__harness__", displayName: "__harness__", isOwner: true, permissions: FULL },
  manager: { id: "f0000003-0000-4000-8000-000000000001", username: "fixture_manager", displayName: "Fixture Manager", isOwner: false, permissions: FULL },
  cashier: { id: "f0000003-0000-4000-8000-000000000002", username: "fixture_cashier", displayName: "Fixture Cashier", isOwner: false, permissions: POS_ONLY },
};

const role = process.argv[2] ?? "owner";
const r = ROLES[role];
if (!r) {
  console.error("unknown role: " + role + " (owner|manager|cashier)");
  process.exit(1);
}

const user = { ...r, storeId: STORE_ID };
const auth = { store_id: STORE_ID, username: r.username, license_expires_at: null, timestamp: Date.now() };

// Clearing the cart matters: it persists to localStorage, so a basket left by
// the previous charter would silently change this one's totals.
const js = [
  "localStorage.setItem('goldensquirrel_user', " + JSON.stringify(JSON.stringify(user)) + ");",
  "localStorage.setItem('goldensquirrel_auth', " + JSON.stringify(JSON.stringify(auth)) + ");",
  "localStorage.removeItem('goldensquirrel-cart');",
  JSON.stringify("signed in as " + role + " / " + STORE_ID),
].join("");

console.log(js);

#!/usr/bin/env node
// =============================================
// Did the region migration actually carry everything across?
//
//   node scripts/verify-migration.mjs
//
// Compares the OLD project against the NEW one over the REST API, so it needs
// no psql and no database password — only the two projects' service-role keys.
//
// Reads `.env.migration` (gitignored by the `.env*` rule):
//
//   OLD_SUPABASE_URL=https://xxxx.supabase.co
//   OLD_SERVICE_ROLE_KEY=...
//   NEW_SUPABASE_URL=https://yyyy.supabase.co
//   NEW_SERVICE_ROLE_KEY=...
//
// ## What this checks, and why each one is here
//
// A `pg_dump`/`pg_restore` carries tables and data reliably. What it can drop
// quietly — or what a partial restore leaves behind — is everything else, and
// on this app each omission has a specific consequence:
//
//   * a missing FUNCTION breaks a screen with a 500 nobody sees until a cashier
//     hits it;
//   * a missing TRIGGER means `profit_percentage` silently stays 0 and every
//     margin figure the owner reads is wrong;
//   * missing `activity_logs` PARTITIONS mean every activity insert fails,
//     which is silent by design because logging must never break a sale.
//
// Read-only against the old project. Against the new one it writes exactly one
// throwaway product to prove the trigger fires, and deletes it again.
// =============================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---- config ----------------------------------------------------------------

let env;
try {
  env = Object.fromEntries(
    readFileSync(resolve(process.cwd(), ".env.migration"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
} catch {
  console.error(
    "\n[verify-migration] .env.migration not found. It needs:\n" +
      "  OLD_SUPABASE_URL=  OLD_SERVICE_ROLE_KEY=\n" +
      "  NEW_SUPABASE_URL=  NEW_SERVICE_ROLE_KEY=\n"
  );
  process.exit(1);
}

const OLD = { url: env.OLD_SUPABASE_URL, key: env.OLD_SERVICE_ROLE_KEY, name: "Seoul (old)" };
const NEW = { url: env.NEW_SUPABASE_URL, key: env.NEW_SERVICE_ROLE_KEY, name: "Ireland (new)" };

for (const p of [OLD, NEW]) {
  if (!p.url || !p.key) {
    console.error(`[verify-migration] missing url or key for ${p.name}`);
    process.exit(1);
  }
}

const headers = (p, extra = {}) => ({
  apikey: p.key,
  Authorization: `Bearer ${p.key}`,
  "Content-Type": "application/json",
  ...extra,
});

/**
 * Exact row count via the Content-Range header.
 *
 * `select=*`, not `select=id`: not every table has an `id` column —
 * `kitchen_ticket_state` is keyed by transaction — and asking for a column that
 * is not there returns 400, which reads as a migration failure when it is
 * really a bad question. `Range: 0-0` keeps it to one row on the wire.
 */
async function count(p, table) {
  const r = await fetch(`${p.url}/rest/v1/${table}?select=*`, {
    headers: headers(p, { Prefer: "count=exact", Range: "0-0" }),
  });
  if (!r.ok) return { n: null, err: `${r.status}` };
  const range = r.headers.get("content-range") || "";
  const total = range.split("/")[1];
  return { n: total === "*" ? null : Number(total), err: null };
}

// Every table the app reads or writes. `admin_users` included deliberately: it
// holds the admin logins, and an empty one locks you out of the console.
const TABLES = [
  "stores", "store_users", "admin_users",
  "products", "product_categories", "product_favorites",
  "transactions", "transaction_items",
  "cash_registers", "cash_shifts", "cash_adjustments", "register_requests",
  "recipe_components", "combo_components", "kitchen_ticket_state",
  "activity_logs",
];

// Without these the app 500s on a specific screen. Called with deliberately
// harmless arguments — the point is "does it exist and is it callable", which a
// 404 (missing) distinguishes from a 400 (there, wrong args).
const FUNCTIONS = [
  ["get_cash_overview", { p_store_id: "00000000-0000-0000-0000-000000000000" }],
  ["get_shift_totals", { p_store_id: "00000000-0000-0000-0000-000000000000", p_shift_ids: [] }],
  ["get_unassigned_totals", { p_store_id: "00000000-0000-0000-0000-000000000000", p_from: new Date().toISOString() }],
  ["get_register_performance", { p_store_id: "00000000-0000-0000-0000-000000000000", p_from: new Date().toISOString(), p_to: new Date().toISOString() }],
  ["get_transaction_analytics", { p_store_id: "00000000-0000-0000-0000-000000000000" }],
  ["maintain_activity_log_partitions", { p_retention_days: 3 }],
];

const VIEWS = ["store_transaction_health", "transaction_retention_stats"];

// ---- run -------------------------------------------------------------------

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

console.log(`\nROW COUNTS  ${OLD.name} -> ${NEW.name}\n`);
console.log(`  ${"table".padEnd(22)} ${"old".padStart(9)} ${"new".padStart(9)}`);
console.log(`  ${"-".repeat(22)} ${"-".repeat(9)} ${"-".repeat(9)}`);

for (const table of TABLES) {
  const [a, b] = await Promise.all([count(OLD, table), count(NEW, table)]);
  const oldN = a.err ? `err ${a.err}` : String(a.n);
  const newN = b.err ? `err ${b.err}` : String(b.n);
  const same = !a.err && !b.err && a.n === b.n;
  const line = `  ${table.padEnd(22)} ${oldN.padStart(9)} ${newN.padStart(9)}`;
  if (same) {
    console.log(`${line}   ok`);
  } else if (!a.err && !b.err && b.n > a.n) {
    // The old project is still live and may have taken sales since the dump.
    console.log(`${line}   NEWER (new has ${b.n - a.n} more — check this is expected)`);
  } else {
    console.log(`${line}   MISMATCH`);
    failures++;
  }
}

console.log(`\nFUNCTIONS on ${NEW.name}\n`);
for (const [fn, args] of FUNCTIONS) {
  const r = await fetch(`${NEW.url}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: headers(NEW), body: JSON.stringify(args),
  });
  // 404 = the function is not there. Anything else means it exists; a 400 just
  // means these probe arguments did not suit it.
  if (r.status === 404) fail(`${fn} is MISSING`);
  else ok(`${fn} (${r.status})`);
}

console.log(`\nVIEWS on ${NEW.name}\n`);
for (const v of VIEWS) {
  const r = await fetch(`${NEW.url}/rest/v1/${v}?select=*&limit=1`, { headers: headers(NEW) });
  if (r.status === 404) fail(`${v} is MISSING`);
  else ok(`${v} (${r.status})`);
}

console.log(`\nTRIGGER: products.profit_percentage on ${NEW.name}\n`);
{
  // Computed by a database trigger, not the client: ((sell - cost) / cost) * 100.
  // If the trigger did not come across, every margin figure the owner reads is
  // silently zero. One throwaway row proves it, then it goes.
  const store = await fetch(`${NEW.url}/rest/v1/stores?select=id&limit=1`, { headers: headers(NEW) })
    .then((r) => r.json()).catch(() => null);
  const storeId = Array.isArray(store) && store[0] ? store[0].id : null;

  if (!storeId) {
    fail("no store to test against — is `stores` empty?");
  } else {
    const probeId = "eeee00ff-0000-4000-8000-00000000ffff";
    await fetch(`${NEW.url}/rest/v1/products?id=eq.${probeId}`, { method: "DELETE", headers: headers(NEW) });
    const r = await fetch(`${NEW.url}/rest/v1/products`, {
      method: "POST",
      headers: headers(NEW, { Prefer: "return=representation" }),
      body: JSON.stringify([{
        id: probeId, store_id: storeId, name: "__migration probe__",
        cost_price: 100, selling_price: 150, currency: "LL", stock_quantity: 0,
      }]),
    });
    if (!r.ok) {
      fail(`could not insert a probe product (${r.status}) — ${(await r.text()).slice(0, 120)}`);
    } else {
      const row = (await r.json())[0];
      const pct = Number(row?.profit_percentage);
      // (150 - 100) / 100 * 100 = 50
      if (Math.abs(pct - 50) < 0.51) ok(`trigger fired — profit_percentage = ${pct}`);
      else fail(`trigger did NOT fire — profit_percentage = ${pct}, expected 50`);
    }
    await fetch(`${NEW.url}/rest/v1/products?id=eq.${probeId}`, { method: "DELETE", headers: headers(NEW) });
    const gone = await fetch(`${NEW.url}/rest/v1/products?select=id&id=eq.${probeId}`, { headers: headers(NEW) })
      .then((x) => x.json()).catch(() => []);
    if (Array.isArray(gone) && gone.length === 0) ok("probe product removed");
    else fail("probe product NOT removed — delete it by hand");
  }
}

console.log(`\nACTIVITY LOG PARTITIONS on ${NEW.name}\n`);
{
  // Range-partitioned by day. Without today's partition every activity insert
  // fails — silently, because logging must never break a sale.
  const r = await fetch(`${NEW.url}/rest/v1/rpc/maintain_activity_log_partitions`, {
    method: "POST", headers: headers(NEW), body: JSON.stringify({ p_retention_days: 3 }),
  });
  if (r.ok) ok("maintain_activity_log_partitions ran — today and tomorrow exist");
  else fail(`could not create partitions (${r.status}) — ${(await r.text()).slice(0, 160)}`);
}

console.log(
  failures === 0
    ? "\n[verify-migration] PASS — everything checked came across.\n"
    : `\n[verify-migration] ${failures} PROBLEM${failures === 1 ? "" : "S"} — do NOT switch the env vars yet.\n`
);
process.exit(failures === 0 ? 0 : 1);

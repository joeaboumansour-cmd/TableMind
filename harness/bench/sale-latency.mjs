#!/usr/bin/env node
// =============================================
// Sale-path latency benchmark.
//
//   node harness/bench/sale-latency.mjs [runs]
//
// Measures POST /api/transactions end to end — the single number a cashier
// experiences as "the sale is going through", and the one Phase 2.1 exists to
// move. Reports the MEDIAN and p90, not the mean: one slow outlier from a cold
// serverless instance should not flatter or damn the result.
//
// Every sale it writes is prefixed BENCH- and deleted afterwards, scoped to the
// harness store.
// =============================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNS = Number(process.argv[2] ?? 15);
const WARMUP = 3;

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const STORE = env.HARNESS_STORE_ID;
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";
const DB = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const AUTH = {
  "content-type": "application/json",
  "x-auth-data": JSON.stringify({ store_id: STORE, user_id: null, user_name: "Bench" }),
};

// A realistic basket: three lines, which is around the median for these shops.
const products = await fetch(
  `${SB}/rest/v1/products?select=id,name,selling_price&store_id=eq.${STORE}&kind=eq.sellable&limit=3`,
  { headers: DB }
).then((r) => r.json());

if (!Array.isArray(products) || products.length < 3) {
  console.error("[bench] need at least 3 sellable fixture products. Run `npm run harness:seed`.");
  process.exit(1);
}

function sale(n) {
  const items = products.map((p) => ({
    product_id: p.id,
    product_name: p.name,
    quantity: 1,
    unit_price: Number(p.selling_price),
    total_price: Number(p.selling_price),
    currency: "LL",
    modifiers: null,
  }));
  const total = items.reduce((s, i) => s + i.total_price, 0);
  return {
    transaction_number: `BENCH-${Date.now()}-${n}`,
    subtotal: total, total_amount: total, amount_paid: total, change_given: 0,
    payment_method: "cash", user_id: null, user_name: "Bench",
    created_at: new Date().toISOString(),
    items,
  };
}

async function once(n) {
  const body = JSON.stringify(sale(n));
  const t0 = performance.now();
  const res = await fetch(`${APP}/api/transactions`, { method: "POST", headers: AUTH, body });
  await res.text();
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`sale failed: ${res.status}`);
  return ms;
}

// Warm the serverless instance and the connection pool first; a cold start is
// a real cost but it is not what this benchmark is comparing.
for (let i = 0; i < WARMUP; i++) await once(`warm${i}`);

const samples = [];
for (let i = 0; i < RUNS; i++) samples.push(await once(i));

samples.sort((a, b) => a - b);
const pct = (p) => samples[Math.min(samples.length - 1, Math.floor((p / 100) * samples.length))];

console.log(`\nPOST /api/transactions — ${RUNS} sales, 3 lines each\n`);
console.log(`  median  ${pct(50).toFixed(0)} ms`);
console.log(`  p90     ${pct(90).toFixed(0)} ms`);
console.log(`  min     ${samples[0].toFixed(0)} ms`);
console.log(`  max     ${samples[samples.length - 1].toFixed(0)} ms`);

// Which path answered? Useful when checking whether a migration is live.
const probe = await fetch(`${SB}/rest/v1/rpc/create_sale`, {
  method: "POST", headers: DB, body: JSON.stringify({ p_store_id: STORE, p_sale: {} }),
});
console.log(`\n  create_sale RPC present: ${probe.status !== 404 ? "YES (atomic path)" : "no (multi-step fallback)"}\n`);

// Clean up.
const rows = await fetch(
  `${SB}/rest/v1/transactions?select=id&store_id=eq.${STORE}&transaction_number=like.BENCH-*`,
  { headers: DB }
).then((r) => r.json());
for (const row of rows ?? []) {
  await fetch(`${SB}/rest/v1/transaction_items?store_id=eq.${STORE}&transaction_id=eq.${row.id}`, { method: "DELETE", headers: DB });
  await fetch(`${SB}/rest/v1/transactions?store_id=eq.${STORE}&id=eq.${row.id}`, { method: "DELETE", headers: DB });
}
console.log(`  cleaned up ${(rows ?? []).length} benchmark sales\n`);

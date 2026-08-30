#!/usr/bin/env node
// =============================================
// Fixture verification.
//
// Confirms the seed produced what Phase 1 depends on, and — the part that
// matters most — that it stayed inside its own tenant. The service-role key
// bypasses RLS, so nothing but seed.mjs's own filtering was protecting the
// other stores; this checks that it held.
// =============================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertNotProduction } from "../guard/assert-not-production.mjs";

const ENV_FILE = resolve(process.cwd(), ".env.test");
assertNotProduction({ envFile: ENV_FILE });

const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY, S = env.HARNESS_STORE_ID;
const H = { apikey: K, Authorization: `Bearer ${K}` };

const count = async (t, q = "") => {
  const r = await fetch(`${U}/rest/v1/${t}?select=id${q}`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  return r.ok ? Number((r.headers.get("content-range") || "").split("/")[1]) : NaN;
};
const get = (t, q) => fetch(`${U}/rest/v1/${t}?${q}`, { headers: H }).then((r) => r.json());

const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass, detail });

// ---- inside the tenant ------------------------------------------------------
check("products seeded", (await count("products", `&store_id=eq.${S}`)) === 2492);
check("ingredients present", (await count("products", `&store_id=eq.${S}&kind=eq.ingredient`)) === 4);
check("transactions seeded", (await count("transactions", `&store_id=eq.${S}`)) === 300);
check("transaction_items seeded", (await count("transaction_items", `&store_id=eq.${S}`)) === 592);
check("two store_users", (await count("store_users", `&store_id=eq.${S}`)) === 2);
check("one register", (await count("cash_registers", `&store_id=eq.${S}`)) === 1);
check("one OPEN shift", (await count("cash_shifts", `&store_id=eq.${S}&status=eq.open`)) === 1);
check("one CLOSED shift", (await count("cash_shifts", `&store_id=eq.${S}&status=eq.closed`)) === 1);
check("recipe has 4 components", (await count("recipe_components", `&store_id=eq.${S}`)) === 4);

// ---- the trigger, not the client -------------------------------------------
// products.profit_percentage is computed by a DB trigger; whatever a client
// sends is overwritten. Confirm it actually fired on fixture rows.
const zero = await get("products", `select=profit_percentage&store_id=eq.${S}&name=eq.Fixture Zero Cost`);
check("zero-cost product -> profit 0 (no divide-by-zero)", Number(zero?.[0]?.profit_percentage) === 0,
  `got ${zero?.[0]?.profit_percentage}`);

const disc = await get("products", `select=cost_price,selling_price,profit_percentage&store_id=eq.${S}&name=eq.Fixture Discounted`);
const d = disc?.[0];
const expected = d ? ((d.selling_price - d.cost_price) / d.cost_price) * 100 : null;
check("profit_percentage matches the trigger formula",
  d != null && Math.abs(Number(d.profit_percentage) - expected) < 0.01,
  `got ${d?.profit_percentage}, formula ${expected?.toFixed(2)}`);

// ---- the money ceiling ------------------------------------------------------
const big = await get("products", `select=selling_price&store_id=eq.${S}&name=eq.Fixture Expensive`);
check("price above the old DECIMAL(10,2) ceiling survived",
  Number(big?.[0]?.selling_price) === 150000000, `got ${big?.[0]?.selling_price}`);

// ---- DST boundary -----------------------------------------------------------
const before = await count("transactions", `&store_id=eq.${S}&created_at=lt.2026-03-28T22:00:00Z`);
const after = await count("transactions", `&store_id=eq.${S}&created_at=gte.2026-03-28T22:00:00Z`);
check("sales exist on BOTH sides of the Beirut DST boundary", before > 0 && after > 0,
  `${before} before / ${after} after`);

// ---- modifiers semantics ----------------------------------------------------
const nullMods = await count("transaction_items", `&store_id=eq.${S}&modifiers=is.null`);
check("retail lines have modifiers NULL, not []", nullMods === 592, `got ${nullMods}`);

// ---- ISOLATION: the whole point --------------------------------------------
const otherProducts = await count("products", `&store_id=neq.${S}`);
const otherTxns = await count("transactions", `&store_id=neq.${S}`);
const otherStores = await count("stores", `&id=neq.${S}`);
check("other tenants' products intact (4999 pre-existing)", otherProducts === 4999, `got ${otherProducts}`);
check("other tenants' transactions intact (118 pre-existing)", otherTxns === 118, `got ${otherTxns}`);
check("other stores intact (5 pre-existing)", otherStores === 5, `got ${otherStores}`);

// ---- report -----------------------------------------------------------------
console.log("");
for (const c of checks) console.log(`  ${c.pass ? "ok  " : "FAIL"}  ${c.name}${c.pass ? "" : `  — ${c.detail}`}`);
const failed = checks.filter((c) => !c.pass);
console.log(`\n  ${checks.length - failed.length}/${checks.length} passed\n`);
process.exit(failed.length ? 1 : 0);

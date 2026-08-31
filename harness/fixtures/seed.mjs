#!/usr/bin/env node
// =============================================
// Fixture seeding — Phase 1.1 of docs/PERF-REFACTOR-PLAN.md
//
//   node harness/fixtures/seed.mjs           seed (tears down first)
//   node harness/fixtures/seed.mjs --down    tear down only
//   node harness/fixtures/seed.mjs --count 300   fewer products, for a quick run
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────
// EVERY statement here is scoped to HARNESS_STORE_ID. There is no RLS standing
// behind it: the service-role key bypasses row-level security by design (audit
// P0-3), so this file's own filtering is the ONLY thing keeping the harness off
// the other tenants' catalogues and sales.
//
// An unscoped write or delete in here is a defect on the level of a money bug.
// `scopedDelete()` exists so that deleting without a store filter is not
// something you can express by accident.
// ─────────────────────────────────────────────────────────────────────────────
//
// Everything is DERIVED: ids from harness/fixtures/ids.mjs, prices from a
// seeded PRNG, timestamps from fixed anchors. Re-seeding produces identical
// rows, which is what makes contract and visual snapshots meaningful.
// =============================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertNotProduction } from "../guard/assert-not-production.mjs";
import {
  productId, categoryId, userId, registerId,
  transactionId, txnItemId, recipeId, comboId, shiftId,
  rng, DST_BOUNDARY_UTC, TXN_WINDOW_START_UTC,
} from "./ids.mjs";

// ---- config -----------------------------------------------------------------

const ENV_FILE = resolve(process.cwd(), ".env.test");
assertNotProduction({ envFile: ENV_FILE });

const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const STORE = env.HARNESS_STORE_ID;

if (!STORE) {
  console.error("[seed] HARNESS_STORE_ID is unset. Refusing to run unscoped.");
  process.exit(1);
}

const argCount = (() => {
  const i = process.argv.indexOf("--count");
  return i > -1 ? Number(process.argv[i + 1]) : 2500;
})();
const DOWN_ONLY = process.argv.includes("--down");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// ---- transport --------------------------------------------------------------

async function req(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { ...H, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}\n${text.slice(0, 500)}`);
  }
  return res;
}

/**
 * DELETE that cannot be written without a store filter.
 *
 * The store scope is applied here rather than passed in, so no call site can
 * omit it — the whole isolation model rests on this one function.
 */
async function scopedDelete(table, extraFilter = "") {
  await req("DELETE", `${table}?store_id=eq.${STORE}${extraFilter}`);
}

/**
 * Give every row in a batch the same keys.
 *
 * PostgREST rejects a bulk insert whose objects differ in shape
 * ("All object keys must match") — it builds one multi-row INSERT with a fixed
 * column list. Fixture rows legitimately differ (only variants carry
 * `parent_id`), so the union of keys is filled in with null rather than each
 * shape being inserted separately, which would be slower and would let the
 * column list drift between batches.
 */
function uniformKeys(rows) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  return rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
}

/** Insert in chunks — one enormous body is refused, and a partial failure is easier to read. */
async function insertAll(table, rows, chunk = 500) {
  rows = uniformKeys(rows);
  for (let i = 0; i < rows.length; i += chunk) {
    await req("POST", table, rows.slice(i, i + chunk), { Prefer: "return=minimal" });
    process.stdout.write(`\r  ${table}: ${Math.min(i + chunk, rows.length)}/${rows.length}   `);
  }
  if (rows.length) process.stdout.write("\n");
}

// ---- teardown ---------------------------------------------------------------

/**
 * Order matters and is dictated by foreign keys, not preference:
 *   - transaction_items before transactions
 *   - recipe_components before products (ingredient_product_id is ON DELETE
 *     RESTRICT — deleting an in-use ingredient is refused, deliberately)
 *   - cash_shifts before cash_registers (register_id is ON DELETE RESTRICT)
 */
async function teardown() {
  console.log(`\n[seed] tearing down store ${STORE}`);
  for (const table of [
    "kitchen_ticket_state",
    "transaction_items",
    "transactions",
    "combo_components",
    "recipe_components",
    "product_favorites",
    "cash_adjustments",
    "cash_shifts",
    "cash_registers",
    "products",
    "product_categories",
    "store_users",
  ]) {
    try {
      await scopedDelete(table);
      console.log(`  cleared ${table}`);
    } catch (e) {
      // kitchen_ticket_state has no store_id in some schema versions; a table
      // that cannot be scoped must be SKIPPED, never cleared unscoped.
      console.log(`  skipped ${table} (${String(e.message).split("\n")[0]})`);
    }
  }
}

// ---- fixture data -----------------------------------------------------------

const CATEGORIES = ["Drinks", "Snacks", "Bakery", "Household", "Made to order"];

function buildCategories() {
  return CATEGORIES.map((name, i) => ({
    id: categoryId(i + 1), store_id: STORE, name,
    sort_order: i, color: null, is_active: true,
    created_at: TXN_WINDOW_START_UTC, updated_at: TXN_WINDOW_START_UTC,
  }));
}

/**
 * The catalogue.
 *
 * Deliberately includes the shapes that have caused real bugs, because a
 * fixture set of well-behaved rows characterizes nothing:
 *
 *   - USD-priced products      (the two-rate conversion path)
 *   - ingredients              (kind='ingredient' -> isSellable must exclude)
 *   - a product with kind absent is NOT representable here (column is NOT
 *     NULL) — that case belongs in the pure-logic suite instead, where a
 *     CachedProduct from a pre-030 device really can have kind undefined
 *   - variants                 (variant_name + parent_id)
 *   - a price above the old DECIMAL(10,2) ceiling (the P1-3 overflow)
 *   - zero cost                (profit_percentage trigger divides by cost)
 *   - a discounted product     (discount applies to base only)
 */
function buildProducts(count) {
  const rand = rng();
  const rows = [];

  // 1..N-20: ordinary LL retail stock.
  const ordinary = Math.max(0, count - 20);
  for (let i = 1; i <= ordinary; i++) {
    const cost = Math.round((5_000 + rand() * 200_000) / 1000) * 1000;
    rows.push({
      id: productId(i), store_id: STORE,
      name: `Fixture Product ${String(i).padStart(4, "0")}`,
      // DIGITS ONLY, and 13 of them.
      //
      // `looksLikeBarcode()` in SmartScanInput is /^[0-9]+$/ -- "anything with
      // a letter in it is somebody typing a product name". A `FIX000000001`
      // fixture barcode therefore routed to SEARCH rather than SCAN, so the
      // whole wedge path went untested while the tests looked like they
      // covered it. The 2-prefix is the in-store range a shop's own labels
      // legitimately use.
      barcode: `2${String(1000000000000 + i).slice(1)}`,
      cost_price: cost,
      selling_price: Math.round((cost * (1.2 + rand() * 0.8)) / 1000) * 1000,
      stock_quantity: Math.floor(rand() * 200),
      min_stock_threshold: 5,
      currency: "LL",
      discount_percentage: 0,
      kind: "sellable", stock_unit: "pcs", serving_qty: 1,
      category_id: categoryId(1 + (i % CATEGORIES.length)),
      updated_at: TXN_WINDOW_START_UTC,
    });
  }

  let n = ordinary;
  const add = (o) => rows.push({
    store_id: STORE, currency: "LL", discount_percentage: 0,
    kind: "sellable", stock_unit: "pcs", serving_qty: 1,
    min_stock_threshold: 0, updated_at: TXN_WINDOW_START_UTC, ...o,
  });

  // USD-priced.
  add({ id: productId(++n), name: "Fixture USD Item", barcode: "2900000000011",
        cost_price: 2, selling_price: 5, currency: "USD", stock_quantity: 50 });
  // Zero cost — profit_percentage trigger must yield 0, not divide by zero.
  add({ id: productId(++n), name: "Fixture Zero Cost", barcode: "2900000000028",
        cost_price: 0, selling_price: 25_000, stock_quantity: 10 });
  // Above the old DECIMAL(10,2) ceiling.
  add({ id: productId(++n), name: "Fixture Expensive", barcode: "2900000000035",
        cost_price: 90_000_000, selling_price: 150_000_000, stock_quantity: 2 });
  // Discounted.
  add({ id: productId(++n), name: "Fixture Discounted", barcode: "2900000000042",
        cost_price: 10_000, selling_price: 40_000, discount_percentage: 25, stock_quantity: 30 });
  // Variant pair.
  const parent = productId(++n);
  add({ id: parent, name: "Fixture Variant Parent", barcode: "2900000000059",
        cost_price: 8_000, selling_price: 20_000, stock_quantity: 12 });
  add({ id: productId(++n), name: "Fixture Variant Parent", variant_name: "Large",
        parent_id: parent, barcode: "2900000000066",
        cost_price: 10_000, selling_price: 30_000, stock_quantity: 8 });

  // Ingredients, in grams — the unit IS the recipe unit (see CLAUDE.md §13).
  const ing = [];
  for (const [label, stock] of [["Pickles", 4000], ["Cheese", 3000], ["Fries", 8000], ["Bread", 500]]) {
    const id = productId(++n);
    ing.push(id);
    add({ id, name: `Fixture ${label}`, barcode: null,
          cost_price: 20, selling_price: 50, stock_quantity: stock,
          kind: "ingredient", stock_unit: label === "Bread" ? "pcs" : "g" });
  }

  // A made-to-order menu item, and a combo bundling it.
  const menu = productId(++n);
  add({ id: menu, name: "Fixture Fries Sandwich", barcode: "2900000000073",
        cost_price: 15_000, selling_price: 60_000, stock_quantity: 0,
        category_id: categoryId(5) });
  const combo = productId(++n);
  add({ id: combo, name: "Fixture Combo Meal", barcode: "2900000000080",
        cost_price: 25_000, selling_price: 95_000, stock_quantity: 0,
        category_id: categoryId(5) });

  return { rows, ingredients: ing, menuProductId: menu, comboProductId: combo, sellableCount: ordinary };
}

function buildRecipe(menuProductId, ingredients) {
  const spec = [
    { qty: 20, isDefault: true, removable: true, max: 3, delta: 5_000 },   // pickles
    { qty: 30, isDefault: true, removable: true, max: 3, delta: 10_000 },  // cheese
    { qty: 150, isDefault: true, removable: false, max: 2, delta: 15_000 },// fries
    { qty: 1, isDefault: true, removable: false, max: 1, delta: 0 },       // bread
  ];
  return ingredients.map((ingredient, i) => ({
    id: recipeId(i + 1), store_id: STORE,
    menu_product_id: menuProductId, ingredient_product_id: ingredient,
    quantity: spec[i].qty, is_default: spec[i].isDefault,
    is_removable: spec[i].removable, max_quantity: spec[i].max,
    price_delta_ll: spec[i].delta, sort_order: i,
    created_at: TXN_WINDOW_START_UTC, updated_at: TXN_WINDOW_START_UTC,
  }));
}

function buildStoreUsers() {
  // Two employees with DIFFERENT permissions, because `inventory` is the
  // pricing permission and the till behaves materially differently without it.
  const full = { pos: true, inventory: true, transactions: true, receipts: true, cash_register: true, kitchen: true };
  const posOnly = { pos: true, inventory: false, transactions: false, receipts: false, cash_register: false, kitchen: false };
  return [
    { id: userId(1), store_id: STORE, username: "fixture_manager", password_hash: "fixture-manager-pw",
      display_name: "Fixture Manager", is_active: true, permissions: full, created_at: TXN_WINDOW_START_UTC },
    { id: userId(2), store_id: STORE, username: "fixture_cashier", password_hash: "fixture-cashier-pw",
      display_name: "Fixture Cashier", is_active: true, permissions: posOnly, created_at: TXN_WINDOW_START_UTC },
  ];
}

function buildRegistersAndShifts() {
  const registers = [
    { id: registerId(1), store_id: STORE, name: "Fixture Front Counter", is_active: true,
      sort_order: 0, created_by_name: "Fixture Manager", created_at: TXN_WINDOW_START_UTC },
  ];
  // One CLOSED shift and one OPEN shift, per the plan. The open one is on the
  // same register, opened after the closed one shut -- one open shift per
  // register is enforced by a partial unique index, so overlapping them would
  // be rejected by the database rather than merely wrong.
  const shifts = [
    { id: shiftId(1), store_id: STORE, register_id: registerId(1),
      business_date: "2026-03-27", status: "closed",
      opened_by: userId(2), opened_by_name: "Fixture Cashier",
      opened_at: "2026-03-27T06:00:00.000Z", opening_ll: 500_000, opening_usd: 0,
      closed_by: userId(1), closed_by_name: "Fixture Manager",
      closed_at: "2026-03-27T18:00:00.000Z", closing_ll: 1_250_000, closing_usd: 0,
      verified: true, assigned_user_id: userId(2), assigned_to_owner: false,
      assigned_user_name: "Fixture Cashier", created_at: "2026-03-27T06:00:00.000Z" },
    { id: shiftId(2), store_id: STORE, register_id: registerId(1),
      business_date: "2026-03-30", status: "open",
      opened_by: userId(1), opened_by_name: "Fixture Manager",
      opened_at: "2026-03-30T06:00:00.000Z", opening_ll: 300_000, opening_usd: 0,
      verified: true, assigned_to_owner: true, created_at: "2026-03-30T06:00:00.000Z" },
  ];
  return { registers, shifts };
}

/**
 * ~300 sales spanning the Beirut DST boundary.
 *
 * Totals are multiples of 5,000 because that is what the cart rounds to and a
 * fixture that ignores it would not characterize the real thing.
 */
function buildTransactions(count, sellableCount) {
  const rand = rng(776655);
  const start = Date.parse(TXN_WINDOW_START_UTC);
  const end = Date.parse(DST_BOUNDARY_UTC) + 3 * 24 * 3600 * 1000;
  const step = Math.floor((end - start) / Math.max(1, count));

  const txns = [], items = [];
  for (let i = 1; i <= count; i++) {
    const createdAt = new Date(start + step * i).toISOString();
    const lineCount = 1 + Math.floor(rand() * 3);
    let subtotal = 0;
    const pending = [];

    for (let j = 0; j < lineCount; j++) {
      const pIdx = 1 + Math.floor(rand() * sellableCount);
      const qty = 1 + Math.floor(rand() * 3);
      const unit = Math.round((10_000 + rand() * 90_000) / 5000) * 5000;
      subtotal += unit * qty;
      pending.push({
        id: txnItemId((i - 1) * 10 + j + 1), store_id: STORE,
        transaction_id: transactionId(i), product_id: productId(pIdx),
        product_name: `Fixture Product ${String(pIdx).padStart(4, "0")}`,
        quantity: qty, unit_price: unit, total_price: unit * qty,
        currency: "LL",
        // `?? null` semantics matter: [] means a menu line with nothing
        // changed, NULL means an ordinary retail line. The kitchen board
        // filters on `modifiers IS NOT NULL`, so collapsing them is a bug.
        modifiers: null,
      });
    }

    const total = Math.round(subtotal / 5000) * 5000;
    const paid = total + (rand() < 0.4 ? 50_000 : 0);

    // Sales before the closed shift's close land in it; later ones are
    // deliberately left unassigned so the Unassigned bucket is exercised.
    const inClosedShift = createdAt <= "2026-03-27T18:00:00.000Z" && createdAt >= "2026-03-27T06:00:00.000Z";

    txns.push({
      id: transactionId(i), store_id: STORE,
      transaction_number: `FIXTURE-${String(i).padStart(5, "0")}`,
      subtotal, total_amount: total,
      amount_paid: paid, change_given: paid - total,
      payment_method: "cash",
      user_id: userId(2), user_name: "Fixture Cashier",
      created_at: createdAt,
      shift_id: inClosedShift ? shiftId(1) : null,
      register_id: inClosedShift ? registerId(1) : null,
    });
    items.push(...pending);
  }
  return { txns, items };
}

// ---- run --------------------------------------------------------------------

async function main() {
  await teardown();
  if (DOWN_ONLY) { console.log("\n[seed] teardown only — done.\n"); return; }

  console.log(`\n[seed] seeding store ${STORE} (${argCount} products)`);

  // Retention OFF for the fixture store.
  //
  // GET /api/transactions filters on store.transaction_retention_days, so with
  // the default window the 300 fixture sales -- dated around the 2026-03-29
  // Beirut DST boundary -- were invisible and the route returned []. The
  // fixtures need dates far enough apart to span a DST change AND need to stay
  // readable, and those two only coexist if the store keeps everything.
  await req("PATCH", `stores?id=eq.${STORE}`,
    { transaction_retention_days: 0 }, { Prefer: "return=minimal" });
  console.log("  retention disabled for the fixture store");

  await insertAll("product_categories", buildCategories());

  const cat = buildProducts(argCount);
  await insertAll("products", cat.rows);

  await insertAll("recipe_components", buildRecipe(cat.menuProductId, cat.ingredients));
  await insertAll("combo_components", [
    { id: comboId(1), store_id: STORE, combo_product_id: cat.comboProductId,
      item_product_id: cat.menuProductId, quantity: 1, sort_order: 0,
      created_at: TXN_WINDOW_START_UTC, updated_at: TXN_WINDOW_START_UTC },
  ]);

  await insertAll("store_users", buildStoreUsers());

  const { registers, shifts } = buildRegistersAndShifts();
  await insertAll("cash_registers", registers);
  await insertAll("cash_shifts", shifts);

  const { txns, items } = buildTransactions(300, cat.sellableCount);
  await insertAll("transactions", txns);
  await insertAll("transaction_items", items);

  console.log(`
[seed] done.
  products      ${cat.rows.length}  (incl. 4 ingredients, 1 menu item, 1 combo, 1 variant pair)
  categories    ${CATEGORIES.length}
  store_users   2  (one full, one pos-only)
  registers     1
  shifts        2  (one closed, one open)
  transactions  ${txns.length}  spanning the 2026-03-29 Beirut DST boundary
  txn items     ${items.length}
`);
}

main().catch((e) => { console.error(`\n[seed] FAILED\n${e.message}\n`); process.exit(1); });

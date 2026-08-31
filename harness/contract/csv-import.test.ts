// =============================================
// Contract: CSV import, `replace_all` (golden flow 7).
//
// THE claim this file exists to hold: replacing the catalogue must NOT destroy
// the store's sales history.
//
// It used to. `transaction_items.product_id` was a blocking FK, so the only
// way to get the product deletes through was to delete every
// `transaction_items` row and every `transactions` row for the store first —
// importing a spreadsheet wiped the shop's entire takings, the dialog never
// warned about it, and nobody had asked for it. Migration 028 made that FK
// `ON DELETE SET NULL`, so sold lines survive on their own denormalised
// name/price/quantity and simply stop pointing at a catalogue row.
//
// ⚠️ THIS FILE IS DESTRUCTIVE. It really does replace the fixture catalogue,
// because a test for a destructive operation that does not perform it proves
// nothing. `afterAll` re-seeds, which is why it is slow and why it lives in
// its own file.
//
// Every request sends HARNESS_STORE_ID and nothing else. The route is
// unauthenticated (audit P0-2) and takes `storeId` from the BODY, so this
// file's own discipline is the only thing scoping it.
// =============================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { call, BASE_URL, STORE_ID } from "./client";

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function count(table: string, q = "") {
  const r = await fetch(`${SB}/rest/v1/${table}?select=id${q}`, {
    headers: { ...DB, Prefer: "count=exact", Range: "0-0" },
  });
  return Number((r.headers.get("content-range") || "").split("/")[1]);
}

const importProduct = (n: number) => ({
  name: `Imported Product ${n}`,
  barcode: `2700000000${String(n).padStart(3, "0")}`,
  cost_price: 10_000,
  selling_price: 25_000,
  currency: "LL" as const,
  profit_percentage: 0, // trigger-computed; whatever is sent is overwritten
  stock_quantity: 5,
  min_stock_threshold: 1,
});

let before = { products: 0, transactions: 0, items: 0, otherProducts: 0 };

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) throw new Error(`No server at ${BASE_URL}. Run: npm run build && npm run start`);

  before = {
    products: await count("products", `&store_id=eq.${STORE_ID}`),
    transactions: await count("transactions", `&store_id=eq.${STORE_ID}`),
    items: await count("transaction_items", `&store_id=eq.${STORE_ID}`),
    otherProducts: await count("products", `&store_id=neq.${STORE_ID}`),
  };
  expect(before.products).toBeGreaterThan(0);
  expect(before.transactions).toBeGreaterThan(0);
});

afterAll(() => {
  // Rebuild the fixture catalogue for every suite that follows.
  execFileSync("node", ["harness/fixtures/seed.mjs"], { stdio: "ignore" });
}, 300_000);

describe("replace_all on a store WITH recipes", () => {
  /**
   * ⚠️ FINDING (audit P2-20). `replace_all` returns **500** for any store that
   * has recipes, because `recipe_components.ingredient_product_id` is
   * `ON DELETE RESTRICT` (migration 031, deliberately — deleting an in-use
   * ingredient should be refused rather than silently breaking a recipe) and
   * the bulk product delete collides with it.
   *
   * Bakeries, coffee shops and snack counters — exactly the store types §13
   * exists for — therefore cannot use CSV replace_all at all.
   *
   * It DOES fail safe: the delete is one statement, so nothing is removed and
   * the catalogue is untouched. The cost is a broken feature and an error
   * message ("Failed to clear existing products") that tells the owner
   * neither why nor what to do about it.
   */
  it("CURRENTLY returns 500, and leaves the catalogue untouched", async () => {
    const r = await call("POST", "/api/products/import", {
      body: {
        storeId: STORE_ID,
        mode: "replace_all",
        fileName: "harness.csv",
        products: [importProduct(1)],
      },
    });
    expect(r.status).toBe(500);

    // Fails safe — this is the part that keeps it out of P1.
    const stillThere = await count("products", `&store_id=eq.${STORE_ID}`);
    expect(stillThere).toBe(before.products);
  });
});

describe("replace_all on a store with no recipes", () => {
  beforeAll(async () => {
    // Remove the recipe rows so the delete can proceed. This is the state an
    // ordinary retail store is already in, and it is what flow 7 is about.
    await fetch(`${SB}/rest/v1/recipe_components?store_id=eq.${STORE_ID}`, {
      method: "DELETE", headers: DB,
    });
    await fetch(`${SB}/rest/v1/combo_components?store_id=eq.${STORE_ID}`, {
      method: "DELETE", headers: DB,
    });
  });

  it("replaces the catalogue and KEEPS the sales history", async () => {
    const r = await call("POST", "/api/products/import", {
      body: {
        storeId: STORE_ID,
        mode: "replace_all",
        fileName: "harness.csv",
        products: [importProduct(1), importProduct(2), importProduct(3)],
      },
    });
    expect(r.status).toBeLessThan(300);

    const after = {
      products: await count("products", `&store_id=eq.${STORE_ID}`),
      transactions: await count("transactions", `&store_id=eq.${STORE_ID}`),
      items: await count("transaction_items", `&store_id=eq.${STORE_ID}`),
      otherProducts: await count("products", `&store_id=neq.${STORE_ID}`),
    };

    // The catalogue really was replaced — 2,492 rows down to 3.
    expect(after.products).toBe(3);
    expect(after.products).toBeLessThan(before.products);

    // ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────
    // Every sale and every sold line survives. If this ever fails, an owner
    // importing a spreadsheet has just lost their takings.
    expect(after.transactions).toBe(before.transactions);
    expect(after.items).toBe(before.items);

    // And no other tenant was touched, despite the route being unauthenticated.
    expect(after.otherProducts).toBe(before.otherProducts);
  });

  it("orphans sold lines rather than deleting them (migration 028)", async () => {
    // The lines whose product was just deleted keep their denormalised
    // name/price/quantity and simply stop pointing at a catalogue row. That is
    // what makes a receipt printable for a product that no longer exists.
    const orphaned = await fetch(
      `${SB}/rest/v1/transaction_items?select=product_id,product_name,quantity,total_price&store_id=eq.${STORE_ID}&product_id=is.null&limit=3`,
      { headers: DB }
    ).then((x) => x.json());

    expect(orphaned.length).toBeGreaterThan(0);
    for (const line of orphaned) {
      expect(line.product_id).toBeNull();
      expect(line.product_name).toBeTruthy();   // still says what was sold
      expect(Number(line.total_price)).toBeGreaterThan(0); // and for how much
    }
  });

  it("the imported products are the ones that came in", async () => {
    const rows = await fetch(
      `${SB}/rest/v1/products?select=name,selling_price,store_id&store_id=eq.${STORE_ID}&order=name`,
      { headers: DB }
    ).then((x) => x.json());

    expect(rows).toHaveLength(3);
    for (const p of rows) {
      expect(p.name).toMatch(/^Imported Product /);
      expect(p.store_id).toBe(STORE_ID);
      expect(Number(p.selling_price)).toBe(25_000);
    }
  });
});

describe("authentication — audit P0-2, FIXED", () => {
  /**
   * This route had NO authentication of any kind, used the service-role key,
   * and took `storeId` from the request BODY. With `mode: 'replace_all'`
   * deleting a store's whole catalogue, anyone who knew a store id could wipe
   * and replace it from an unauthenticated request.
   *
   * Now the caller is resolved from the header and the body's storeId is
   * ignored outright — taking tenancy from the same request that names the
   * rows is what made the hole.
   *
   * These deliberately do NOT demonstrate the old hole against another tenant:
   * proving it by wiping a real store's catalogue is not a test, it is the
   * damage.
   */
  it("refuses a caller with no auth header", async () => {
    const r = await call("POST", "/api/products/import", {
      headers: { "content-type": "application/json" },
      body: { storeId: STORE_ID, mode: "create_only", products: [importProduct(97)] },
    });
    expect(r.status).toBe(401);
  });

  it("refuses an unparseable auth header", async () => {
    const r = await call("POST", "/api/products/import", {
      headers: { "content-type": "application/json", "x-auth-data": "{nope" },
      body: { storeId: STORE_ID, mode: "create_only", products: [importProduct(96)] },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("refuses an unknown store", async () => {
    const r = await call("POST", "/api/products/import", {
      headers: {
        "content-type": "application/json",
        "x-auth-data": JSON.stringify({
          store_id: "00000000-0000-4000-8000-0000deadbeef",
          user_id: "00000000-0000-4000-8000-0000deadbeef",
        }),
      },
      body: { storeId: STORE_ID, mode: "create_only", products: [importProduct(95)] },
    });
    expect(r.status).toBe(401);
  });

  it("IGNORES a body storeId naming another store — the caller decides", async () => {
    // The whole shape of the old bug. An authenticated caller pointing the
    // import at someone else's store must affect only their own.
    const before = await count("products", `&store_id=neq.${STORE_ID}`);

    const r = await call("POST", "/api/products/import", {
      body: {
        storeId: "00000000-0000-4000-8000-0000deadbeef",
        mode: "create_only",
        products: [importProduct(94)],
      },
    });
    expect(r.status).toBeLessThan(300);

    // No other tenant touched...
    expect(await count("products", `&store_id=neq.${STORE_ID}`)).toBe(before);
    // ...and the row landed in the CALLER's store.
    const mine = await fetch(
      `${SB}/rest/v1/products?select=store_id&store_id=eq.${STORE_ID}&name=eq.Imported Product 94`,
      { headers: DB }
    ).then((x) => x.json());
    expect(mine.length).toBe(1);
    expect(mine[0].store_id).toBe(STORE_ID);
  });

  it("still accepts a properly authenticated caller", async () => {
    const r = await call("POST", "/api/products/import", {
      body: { storeId: STORE_ID, mode: "create_only", products: [importProduct(93)] },
    });
    expect(r.status).toBeLessThan(300);
  });
});

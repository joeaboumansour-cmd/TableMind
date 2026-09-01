// =============================================
// Contract: inventory writes (golden flow 6).
//
// The load-bearing claim, and the mirror of flow 7's: DELETING A SOLD PRODUCT
// must not delete what it sold. Migration 028 made
// `transaction_items.product_id` `ON DELETE SET NULL` so a sold line survives
// on its own denormalised name/price/quantity.
//
// Also pins the pricing write path (`POST /api/products`), which is what
// `products/write.ts` uses so a reprice survives an outage, and the
// trigger-computed `profit_percentage` that a client must never validate on.
// =============================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { call, BASE_URL, STORE_ID } from "./client";

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const db = {
  get: (p: string) => fetch(`${SB}/rest/v1/${p}`, { headers: DB }).then((r) => r.json()),
  post: (p: string, body: unknown) =>
    fetch(`${SB}/rest/v1/${p}`, { method: "POST", headers: DB, body: JSON.stringify(body) }),
  patch: (p: string, body: unknown) =>
    fetch(`${SB}/rest/v1/${p}`, { method: "PATCH", headers: DB, body: JSON.stringify(body) }),
  del: (p: string) => fetch(`${SB}/rest/v1/${p}`, { method: "DELETE", headers: DB }),
};

/** Products this file creates, removed in afterAll. Fixtures are untouched. */
const created: string[] = [];

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) throw new Error(`No server at ${BASE_URL}. Run: npm run build && npm run start`);
});

afterAll(async () => {
  for (const id of created) {
    await db.del(`transaction_items?store_id=eq.${STORE_ID}&product_id=eq.${id}`);
    await db.del(`products?store_id=eq.${STORE_ID}&id=eq.${id}`);
  }
  await db.del(`transactions?store_id=eq.${STORE_ID}&transaction_number=like.INV-*`);
});

describe("POST /api/products — the offline-capable write", () => {
  it("accepts a client-generated id, making the call an idempotent upsert", async () => {
    // The id is minted client-side so a retry cannot create a second row —
    // which is what lets the write be queued and replayed after an outage.
    const id = randomUUID();
    created.push(id);

    const body = {
      id, store_id: STORE_ID, name: "Contract Product A",
      barcode: "2800000000001", cost_price: 10_000, selling_price: 40_000,
      currency: "LL", stock_quantity: 7, min_stock_threshold: 1,
      kind: "sellable", stock_unit: "pcs", serving_qty: 1, discount_percentage: 0,
    };

    const first = await call("POST", "/api/products", { body });
    expect(first.status).toBeLessThan(300);

    const second = await call("POST", "/api/products", { body });
    expect(second.status).toBeLessThan(300);

    const rows = await db.get(`products?select=id,name&store_id=eq.${STORE_ID}&id=eq.${id}`);
    expect(rows).toHaveLength(1);
  });

  it("computes profit_percentage by TRIGGER, ignoring whatever the client sends", async () => {
    const id = randomUUID();
    created.push(id);

    await call("POST", "/api/products", {
      body: {
        id, store_id: STORE_ID, name: "Contract Product B",
        barcode: "2800000000002", cost_price: 10_000, selling_price: 50_000,
        currency: "LL", stock_quantity: 1, min_stock_threshold: 0,
        kind: "sellable", stock_unit: "pcs", serving_qty: 1, discount_percentage: 0,
        profit_percentage: 99999, // deliberately absurd
      },
    });

    const rows = await db.get(`products?select=profit_percentage&store_id=eq.${STORE_ID}&id=eq.${id}`);
    // ((50000 - 10000) / 10000) * 100 = 400. NOT 99999.
    expect(Number(rows[0].profit_percentage)).toBeCloseTo(400, 2);
  });

  it("records the product under the CALLER's store, ignoring a body store_id", async () => {
    const id = randomUUID();
    created.push(id);

    await call("POST", "/api/products", {
      body: {
        id, store_id: "00000000-0000-4000-8000-0000deadbeef",
        name: "Contract Product C", barcode: "2800000000003",
        cost_price: 1_000, selling_price: 5_000, currency: "LL",
        stock_quantity: 1, min_stock_threshold: 0,
        kind: "sellable", stock_unit: "pcs", serving_qty: 1, discount_percentage: 0,
      },
    });

    const rows = await db.get(`products?select=store_id&id=eq.${id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].store_id).toBe(STORE_ID);
  });

  it("a reprice is an update, not a duplicate row", async () => {
    const id = randomUUID();
    created.push(id);
    const base = {
      id, store_id: STORE_ID, name: "Contract Product D",
      barcode: "2800000000004", cost_price: 10_000, currency: "LL",
      stock_quantity: 3, min_stock_threshold: 0,
      kind: "sellable", stock_unit: "pcs", serving_qty: 1, discount_percentage: 0,
    };

    await call("POST", "/api/products", { body: { ...base, selling_price: 30_000 } });
    await call("POST", "/api/products", { body: { ...base, selling_price: 45_000 } });

    const rows = await db.get(`products?select=id,selling_price&store_id=eq.${STORE_ID}&id=eq.${id}`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].selling_price)).toBe(45_000);
  });
});

describe("deleting a SOLD product — invariant behind migration 028", () => {
  it("keeps the sold line, with what it said and what it cost", async () => {
    // Create a product, sell it, then delete it — the exact sequence an owner
    // performs when they discontinue a line.
    const productId = randomUUID();
    created.push(productId);

    await call("POST", "/api/products", {
      body: {
        id: productId, store_id: STORE_ID, name: "Discontinued Item",
        barcode: "2800000000010", cost_price: 20_000, selling_price: 60_000,
        currency: "LL", stock_quantity: 10, min_stock_threshold: 0,
        kind: "sellable", stock_unit: "pcs", serving_qty: 1, discount_percentage: 0,
      },
    });

    const txnNumber = `INV-${Date.now()}`;
    const sale = await call("POST", "/api/transactions", {
      body: {
        transaction_number: txnNumber,
        subtotal: 60_000, total_amount: 60_000, amount_paid: 60_000, change_given: 0,
        payment_method: "cash", user_id: null, user_name: "Fixture Manager",
        created_at: new Date().toISOString(),
        items: [{
          product_id: productId, product_name: "Discontinued Item", quantity: 1,
          unit_price: 60_000, total_price: 60_000, currency: "LL", modifiers: null,
        }],
      },
    });
    expect(sale.status).toBeLessThan(300);

    const txn = await db.get(
      `transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=eq.${txnNumber}`
    );
    expect(txn).toHaveLength(1);

    // Now discontinue it.
    await db.del(`products?store_id=eq.${STORE_ID}&id=eq.${productId}`);
    expect(await db.get(`products?select=id&id=eq.${productId}`)).toHaveLength(0);

    // ── THE ASSERTION ────────────────────────────────────────────────────
    // The sale and its line survive. product_id goes NULL; everything a
    // receipt needs is still on the line itself.
    const line = await db.get(
      `transaction_items?select=product_id,product_name,quantity,unit_price,total_price&transaction_id=eq.${txn[0].id}`
    );
    expect(line).toHaveLength(1);
    expect(line[0].product_id).toBeNull();
    expect(line[0].product_name).toBe("Discontinued Item");
    expect(Number(line[0].total_price)).toBe(60_000);

    const stillThere = await db.get(
      `transactions?select=id,total_amount&store_id=eq.${STORE_ID}&transaction_number=eq.${txnNumber}`
    );
    expect(stillThere).toHaveLength(1);
    expect(Number(stillThere[0].total_amount)).toBe(60_000);
  });
});

describe("an in-use INGREDIENT is a different case", () => {
  it("cannot be deleted while a recipe references it — refused, not cascaded", async () => {
    // ON DELETE RESTRICT, deliberately: silently breaking a recipe is worse
    // than refusing. Same principle as cash_shifts.register_id. (This is also
    // the constraint that makes CSV replace_all fail — audit P2-20.)
    const ing = await db.get(
      `recipe_components?select=ingredient_product_id&store_id=eq.${STORE_ID}&limit=1`
    );
    expect(ing.length).toBeGreaterThan(0);

    const res = await fetch(
      `${SB}/rest/v1/products?store_id=eq.${STORE_ID}&id=eq.${ing[0].ingredient_product_id}`,
      { method: "DELETE", headers: DB }
    );
    expect(res.ok).toBe(false);

    const still = await db.get(`products?select=id&id=eq.${ing[0].ingredient_product_id}`);
    expect(still).toHaveLength(1);
  });
});

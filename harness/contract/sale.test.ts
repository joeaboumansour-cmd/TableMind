// =============================================
// Contract: POST /api/transactions — the money path.
//
// The most important contract in the suite. Phase 2.1 replaces this whole path
// with one atomic plpgsql function, and these are what say the replacement
// behaved identically.
//
// Invariants pinned here:
//   #7  idempotency is UNIQUE (store_id, transaction_number) + the 23505 branch
//   #9  client-supplied stock_decrements take priority over items
//   #10 a sale is NEVER blocked by cash-register state
//   #17 modifiers `?? null` — [] and null are different to the kitchen board
//
// Every sale written here uses a transaction_number prefixed CONTRACT- so it
// can be removed afterwards without touching the FIXTURE- rows the rest of the
// suite reads.
// =============================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { call, authHeaders, BASE_URL, STORE_ID, FIXTURE } from "./client";

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), ".env.test"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const DB = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const db = {
  async get(path: string) {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: DB });
    return r.json();
  },
  async del(path: string) {
    await fetch(`${SB}/rest/v1/${path}`, { method: "DELETE", headers: DB });
  },
};

/** A sale body, shaped as the till sends one. */
function sale(over: Record<string, unknown> = {}) {
  return {
    transaction_number: `CONTRACT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    subtotal: 100_000,
    total_amount: 100_000,
    amount_paid: 100_000,
    change_given: 0,
    payment_method: "cash",
    user_id: FIXTURE.managerUserId,
    user_name: "Fixture Manager",
    created_at: new Date().toISOString(),
    items: [
      {
        product_id: FIXTURE.firstProductId,
        product_name: "Fixture Product 0001",
        quantity: 1,
        unit_price: 100_000,
        total_price: 100_000,
        currency: "LL",
        modifiers: null,
      },
    ],
    ...over,
  };
}

const written: string[] = [];
const track = <T extends { transaction_number: string }>(body: T) => { written.push(body.transaction_number); return body; };

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) throw new Error(`No server at ${BASE_URL}. Run: npm run build && npm run start`);
});

afterAll(async () => {
  // Remove only the CONTRACT- sales this file created, scoped to the harness
  // store. The FIXTURE- rows every other test reads are left alone.
  for (const num of written) {
    const rows = await db.get(`transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=eq.${num}`);
    for (const row of rows ?? []) {
      await db.del(`transaction_items?store_id=eq.${STORE_ID}&transaction_id=eq.${row.id}`);
      await db.del(`transactions?store_id=eq.${STORE_ID}&id=eq.${row.id}`);
    }
  }
});

describe("a plain sale", () => {
  it("is accepted and returns the created transaction", async () => {
    const body = track(sale());
    const r = await call("POST", "/api/transactions", { body });
    expect(r.status).toBeLessThan(300);
    expect(r.shape).toMatchSnapshot();
  });

  it("writes line items", async () => {
    const body = track(sale());
    await call("POST", "/api/transactions", { body });
    const rows = await db.get(
      `transactions?select=id,transaction_number&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(rows).toHaveLength(1);
    const items = await db.get(`transaction_items?select=id,product_id,modifiers&transaction_id=eq.${rows[0].id}`);
    expect(items.length).toBe(1);
    // Invariant #17 — an ordinary retail line is NULL, not [].
    expect(items[0].modifiers).toBeNull();
  });
});

describe("idempotency — invariant #7", () => {
  // The whole of offline safety. The sync engine can push the same queued sale
  // twice; UNIQUE (store_id, transaction_number) plus the 23505 branch is what
  // makes the second push a no-op rather than a double charge.
  it("the SAME transaction_number twice creates exactly ONE row", async () => {
    const body = track(sale());

    const first = await call("POST", "/api/transactions", { body });
    const second = await call("POST", "/api/transactions", { body });

    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300); // a duplicate is NOT an error

    const rows = await db.get(
      `transactions?select=id&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(rows).toHaveLength(1);
  });

  it("the duplicate response is flagged as such", async () => {
    const body = track(sale());
    await call("POST", "/api/transactions", { body });
    const second = await call("POST", "/api/transactions", { body });
    expect(second.shape).toMatchSnapshot();
    expect(JSON.stringify(second.body)).toContain("duplicat");
  });

  it("does not double-decrement stock", async () => {
    const body = track(sale());
    const before = await db.get(`products?select=stock_quantity&id=eq.${FIXTURE.firstProductId}`);

    await call("POST", "/api/transactions", { body });
    await call("POST", "/api/transactions", { body });

    const after = await db.get(`products?select=stock_quantity&id=eq.${FIXTURE.firstProductId}`);
    expect(before[0].stock_quantity - after[0].stock_quantity).toBe(1);
  });
});

describe("stock decrements — invariant #9", () => {
  it("client-supplied stock_decrements take priority over items", async () => {
    // A menu line must deduct its INGREDIENTS, not itself. The client computes
    // this because the recipe at the time of sale is the right recipe.
    const ingredient = await db.get(
      `products?select=id,stock_quantity&store_id=eq.${STORE_ID}&kind=eq.ingredient&order=id.asc&limit=1`
    );
    const ing = ingredient[0];
    const menuBefore = await db.get(`products?select=stock_quantity&id=eq.${FIXTURE.firstProductId}`);

    const body = track(sale({ stock_decrements: [{ product_id: ing.id, quantity: 20 }] }));
    await call("POST", "/api/transactions", { body });

    const ingAfter = await db.get(`products?select=stock_quantity&id=eq.${ing.id}`);
    const menuAfter = await db.get(`products?select=stock_quantity&id=eq.${FIXTURE.firstProductId}`);

    expect(ing.stock_quantity - ingAfter[0].stock_quantity).toBe(20);
    // The line's own product must NOT also be decremented.
    expect(menuBefore[0].stock_quantity).toBe(menuAfter[0].stock_quantity);
  });
});

describe("a sale is never blocked — invariant #10", () => {
  // No user_id means the STORE OWNER, who has no store_users row and is
  // represented by `assigned_to_owner = true`. The fixture's open shift is
  // assigned that way, so this also pins the resolution rule: matched on the
  // sale's own created_at against the assigned shift's window, never on
  // "what is open right now".
  it("succeeds with no user_id, resolving to the owner's open shift", async () => {
    const body = track(sale({ user_id: null }));
    const r = await call("POST", "/api/transactions", { body });
    expect(r.status).toBeLessThan(300);

    const rows = await db.get(
      `transactions?select=shift_id,register_id&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shift_id).toBe(FIXTURE.openShiftId);
    expect(rows[0].register_id).toBe(FIXTURE.registerId);
  });

  it("an EMPLOYEE with no assigned shift lands unassigned, not refused", async () => {
    // The fixture cashier is assigned to the CLOSED shift, whose window ended
    // in March — a sale now matches nothing and must still be recorded.
    const body = track(sale({ user_id: FIXTURE.cashierUserId }));
    const r = await call("POST", "/api/transactions", { body });
    expect(r.status).toBeLessThan(300);

    const rows = await db.get(
      `transactions?select=shift_id&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(rows[0].shift_id).toBeNull(); // Unassigned bucket, not a refusal
  });

  /**
   * audit P1-11 — FIXED by migration 038 (the atomic sale RPC).
   *
   * A sale whose `user_id` names a `store_users` row that no longer exists
   * USED to be rejected with 500, from a 23503 on
   * `transactions_user_id_fkey`. That lost money:
   *
   *   1. a cashier rings sales offline; they queue carrying their user_id
   *   2. the employee leaves and an admin deletes them — DELETE
   *      /api/admin/store-users is a HARD delete
   *   3. the till reconnects and sync pushes the queued sales
   *   4. 23503 -> 500 -> the client reads any 500 as an offline condition,
   *      retries, exhausts its 5 attempts, and DEAD-LETTERS the sale
   *
   * `create_sale` now coerces an unresolvable user_id to NULL, exactly as
   * shift resolution already degrades to a NULL shift_id. The sale is
   * RECORDED rather than lost, and `user_name` — stored denormalised
   * alongside — still says who rang it.
   *
   * This test now pins the FIX. If it ever goes back to 500, a shop is
   * losing sales again.
   */
  it("records a sale from a deleted employee, attributing it to nobody", async () => {
    const body = track(sale({ user_id: "00000000-0000-4000-8000-00000000dead" }));
    const r = await call("POST", "/api/transactions", { body });
    expect(r.status).toBeLessThan(300);

    const rows = await db.get(
      `transactions?select=id,user_id,user_name,total_amount&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    // The sale exists — this is the whole point.
    expect(rows).toHaveLength(1);
    // Attributed to nobody rather than to a ghost...
    expect(rows[0].user_id).toBeNull();
    // ...but who rang it is not lost, because user_name is denormalised.
    expect(rows[0].user_name).toBe("Fixture Manager");
    // And the money is right.
    expect(Number(rows[0].total_amount)).toBe(100_000);
  });

  it("drops a user_id belonging to ANOTHER store rather than recording it", async () => {
    // The same coercion is scoped by store, so a forged id cannot attribute a
    // sale to someone in a different tenant.
    const other = await db.get(`store_users?select=id&store_id=neq.${STORE_ID}&limit=1`);
    if (!other?.length) return;

    const body = track(sale({ user_id: other[0].id }));
    const r = await call("POST", "/api/transactions", { body });
    expect(r.status).toBeLessThan(300);

    const rows = await db.get(
      `transactions?select=user_id&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(rows[0].user_id).toBeNull();
  });

  it("succeeds for a product with no stock left", async () => {
    const zero = await db.get(
      `products?select=id,name&store_id=eq.${STORE_ID}&stock_quantity=lte.0&limit=1`
    );
    if (!zero.length) return; // nothing at zero in this fixture set
    const body = track(sale({
      items: [{
        product_id: zero[0].id, product_name: zero[0].name, quantity: 5,
        unit_price: 10_000, total_price: 50_000, currency: "LL", modifiers: null,
      }],
    }));
    const r = await call("POST", "/api/transactions", { body });
    expect(r.status).toBeLessThan(300); // stock goes negative; the sale stands
  });
});

describe("created_at is clamped, never trusted", () => {
  it("a future timestamp is pulled back to now", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const body = track(sale({ created_at: future }));
    await call("POST", "/api/transactions", { body });

    const rows = await db.get(
      `transactions?select=created_at&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(Date.parse(rows[0].created_at)).toBeLessThan(Date.parse(future));
  });

  it("a PAST timestamp is preserved — that is the offline sale", async () => {
    // The audit P1-1 fix: three days of offline trading must not all be
    // recorded as having happened when the link came back.
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const body = track(sale({ created_at: past }));
    await call("POST", "/api/transactions", { body });

    const rows = await db.get(
      `transactions?select=created_at&store_id=eq.${STORE_ID}&transaction_number=eq.${body.transaction_number}`
    );
    expect(Math.abs(Date.parse(rows[0].created_at) - Date.parse(past))).toBeLessThan(2000);
  });
});

describe("tenancy on write", () => {
  it("records the sale under the CALLER's store, ignoring any store_id in the body", async () => {
    const body = track(sale({ store_id: "00000000-0000-4000-8000-0000deadbeef" }));
    await call("POST", "/api/transactions", { body, headers: authHeaders() });

    const rows = await db.get(
      `transactions?select=store_id&transaction_number=eq.${body.transaction_number}`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].store_id).toBe(STORE_ID);
  });
});

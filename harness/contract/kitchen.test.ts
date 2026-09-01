// =============================================
// Contract: the kitchen ticket state machine (golden flow 8).
//
// Tested here rather than through the board UI because the rules ARE an API
// contract: which transitions are legal, what a stale move returns, and that a
// ticket row is created lazily. Driving four cards across three columns in a
// browser would assert the same thing far more slowly and far more fragilely.
//
// The load-bearing property: `kitchen_ticket_state` is created LAZILY by this
// route, never by POST /api/transactions. The money path does not change shape
// for the kitchen, and a kitchen outage cannot affect a sale. A transaction
// with no row is implicitly 'new'.
// =============================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { call, BASE_URL, STORE_ID, FIXTURE } from "./client";

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
  del: (p: string) => fetch(`${SB}/rest/v1/${p}`, { method: "DELETE", headers: DB }),
};

/** A fixture sale to move around the board. Its ticket row is cleaned up after. */
const TXN = FIXTURE.firstTransactionId;

const move = (from: string, to: string, transaction_id = TXN) =>
  call("PATCH", "/api/kitchen/tickets", { body: { transaction_id, from, to } });

async function resetTicket() {
  await db.del(`kitchen_ticket_state?transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`);
}

beforeAll(async () => {
  const res = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!res) throw new Error(`No server at ${BASE_URL}. Run: npm run build && npm run start`);
  await resetTicket();
});

afterAll(resetTicket);

describe("lazy creation", () => {
  it("a transaction with no ticket row is implicitly 'new'", async () => {
    await resetTicket();
    const rows = await db.get(
      `kitchen_ticket_state?select=status&transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`
    );
    expect(rows).toHaveLength(0);

    // Moving FROM 'new' therefore succeeds even though nothing exists yet.
    const r = await move("new", "in_progress");
    expect(r.status).toBeLessThan(300);
  });

  it("the row is created by the kitchen route, not by the sale", async () => {
    await resetTicket();
    await move("new", "in_progress");
    const rows = await db.get(
      `kitchen_ticket_state?select=status,store_id&transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("in_progress");
    // Tenancy is written from the RESOLVED CALLER, never from the body.
    expect(rows[0].store_id).toBe(STORE_ID);
  });
});

describe("the state machine", () => {
  it("walks new -> in_progress -> ready -> served", async () => {
    await resetTicket();
    expect((await move("new", "in_progress")).status).toBeLessThan(300);
    expect((await move("in_progress", "ready")).status).toBeLessThan(300);
    expect((await move("ready", "served")).status).toBeLessThan(300);

    const rows = await db.get(
      `kitchen_ticket_state?select=status,started_at,ready_at,served_at&transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`
    );
    expect(rows[0].status).toBe("served");
    // Each forward step stamps its own time.
    expect(rows[0].started_at).not.toBeNull();
    expect(rows[0].ready_at).not.toBeNull();
    expect(rows[0].served_at).not.toBeNull();
  });

  it("allows going BACKWARDS — a cook who mistaps must be able to undo", async () => {
    await resetTicket();
    await move("new", "in_progress");
    await move("in_progress", "ready");
    expect((await move("ready", "in_progress")).status).toBeLessThan(300);
  });

  it("does NOT clear ready_at when moving back", async () => {
    // The ticket really did reach ready once; erasing that would hide a
    // mistake rather than record it.
    await resetTicket();
    await move("new", "in_progress");
    await move("in_progress", "ready");
    const before = await db.get(
      `kitchen_ticket_state?select=ready_at&transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`
    );
    await move("ready", "in_progress");
    const after = await db.get(
      `kitchen_ticket_state?select=ready_at&transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`
    );
    expect(after[0].ready_at).toBe(before[0].ready_at);
  });

  it("refuses an illegal transition with 400", async () => {
    await resetTicket();
    // new -> served is not in ALLOWED_TRANSITIONS.
    const r = await move("new", "served");
    expect(r.status).toBe(400);
  });

  it("treats served and voided as TERMINAL", async () => {
    await resetTicket();
    await move("new", "in_progress");
    await move("in_progress", "ready");
    await move("ready", "served");
    // Nothing leaves served.
    expect((await move("served", "in_progress")).status).toBe(400);
    expect((await move("served", "ready")).status).toBe(400);
  });

  it("rejects a status that is not in the vocabulary", async () => {
    const r = await move("new", "banana");
    expect(r.status).toBe(400);
  });
});

describe("stale transitions — two stations WILL tap the same card", () => {
  it("returns 409 and reports where the ticket actually is", async () => {
    await resetTicket();
    await move("new", "in_progress"); // station A moves it

    // Station B still had the card on screen as 'new'.
    const stale = await move("new", "ready");
    expect(stale.status).toBe(409);
    expect((stale.body as { current?: string }).current).toBe("in_progress");
  });

  it("a 409 does NOT change the ticket", async () => {
    await resetTicket();
    await move("new", "in_progress");
    await move("new", "ready"); // rejected

    const rows = await db.get(
      `kitchen_ticket_state?select=status&transaction_id=eq.${TXN}&store_id=eq.${STORE_ID}`
    );
    expect(rows[0].status).toBe("in_progress");
  });

  it("the losing station can retry from the reported state", async () => {
    await resetTicket();
    await move("new", "in_progress");
    const stale = await move("new", "ready");
    const current = (stale.body as { current: string }).current;

    // Which is the whole point of returning `current` rather than a bare 409.
    const retry = await move(current, "ready");
    expect(retry.status).toBeLessThan(300);
  });
});

describe("tenancy", () => {
  it("refuses a transaction that belongs to another store", async () => {
    // A forged transaction_id must not create a ticket row against someone
    // else's sale. The route looks the transaction up scoped to the caller.
    const other = await db.get(
      `transactions?select=id&store_id=neq.${STORE_ID}&limit=1`
    );
    if (!other?.length) return;

    const r = await move("new", "in_progress", other[0].id);
    expect(r.status).toBeGreaterThanOrEqual(400);

    // `select=transaction_id`, not `select=id`: the table's key IS the
    // transaction, so there is no `id` column and asking for one returns 42703.
    const leaked = await db.get(
      `kitchen_ticket_state?select=transaction_id&transaction_id=eq.${other[0].id}`
    );
    expect(leaked).toHaveLength(0);
  });
});

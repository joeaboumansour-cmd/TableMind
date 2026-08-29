// =============================================
// /api/kitchen/tickets — the kitchen board
// =============================================
// GET   the live tickets for a store
// PATCH move one ticket to another status
//
// ## The money path is not touched
//
// `POST /api/transactions` knows nothing about this route. A ticket's state
// row is created LAZILY, here, the first time someone moves it. Until then a
// paid sale simply has no row and is implicitly 'new'.
//
// That is deliberate and load-bearing: a kitchen outage, a missing table, or
// this route 500ing cannot affect a sale. Do not "improve" this by inserting
// a ticket at checkout.
//
// ## Auth
//
// resolveCaller() — the hardened cash-route pattern: the owner is identified
// positively (session id === store id), an employee's permissions are looked
// up in `store_users`. Gated on the `kitchen` section.
//
// `x-auth-data` is still an unsigned client header (audit P0-1). Unchanged
// here; do not describe this route as authenticated until that lands.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller, canAccessSection } from "@/lib/auth/apiCaller";
import type { CartLineModifier } from "@/lib/types/cart";
import { describeModifiers } from "@/lib/pos/modifierSummary";
import {
  canTransition,
  isLiveStatus,
  isTicketStatus,
  timestampFieldFor,
  type KitchenTicket,
  type KitchenTicketItem,
  type TicketStatus,
} from "@/lib/kitchen/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How far back the board looks.
 *
 * A kitchen screen left running overnight must not accumulate a day of sales,
 * and nothing older than a shift is still food waiting to be made.
 */
const WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Hard cap on rows pulled per poll.
 *
 * PostgREST silently caps an unbounded select at 1000, so the limit is stated
 * explicitly rather than discovered. Terminal tickets are filtered out in JS
 * after the fetch — filtering them in the query would turn the embedded state
 * into an inner join and drop every ticket that has NO state row yet, which is
 * precisely the set the board most needs to show.
 */
const MAX_ROWS = 300;

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireKitchenCaller(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }
  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  const caller = await resolveCaller(supabase, storeId, userId);
  if (!caller) return { error: bad("Unauthorized", 401) };
  if (!canAccessSection(caller, "kitchen")) return { error: bad("Forbidden", 403) };
  return { supabase, storeId, caller };
}

interface TxnRow {
  id: string;
  transaction_number: string;
  created_at: string;
  transaction_items: Array<{
    id: string;
    product_name: string;
    quantity: number;
    modifiers: CartLineModifier[] | null;
    note: string | null;
  }> | null;
  kitchen_ticket_state:
    | { status: string; claimed_by: string | null; started_at: string | null; ready_at: string | null }
    | Array<{ status: string; claimed_by: string | null; started_at: string | null; ready_at: string | null }>
    | null;
}

/**
 * PostgREST returns a one-to-one embed as an object, but returns an array when
 * it cannot prove uniqueness. transaction_id is the PRIMARY KEY of
 * kitchen_ticket_state so there can only ever be one — normalise both shapes
 * rather than depending on which one comes back.
 */
function firstState(value: TxnRow["kitchen_ticket_state"]) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

// ── GET ────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const resolved = await requireKitchenCaller(request);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      id,
      transaction_number,
      created_at,
      transaction_items ( id, product_name, quantity, modifiers, note ),
      kitchen_ticket_state ( status, claimed_by, started_at, ready_at )
    `
    )
    .eq("store_id", storeId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error("[Kitchen] List failed:", error.message);
    return bad("Could not load tickets", 500);
  }

  const tickets: KitchenTicket[] = [];
  for (const row of (data || []) as unknown as TxnRow[]) {
    const state = firstState(row.kitchen_ticket_state);
    // No state row means nobody has touched it: implicitly 'new'.
    const status: TicketStatus =
      state && isTicketStatus(state.status) ? state.status : "new";
    if (!isLiveStatus(status)) continue;

    const items: KitchenTicketItem[] = (row.transaction_items || []).map((item) => ({
      id: item.id,
      product_name: item.product_name,
      quantity: item.quantity,
      // Formatted server-side with the SAME helper the cart and receipt use,
      // so a cook and a customer never read different words for one change.
      modifiers: describeModifiers(item.modifiers),
      note: item.note ?? null,
    }));

    tickets.push({
      transaction_id: row.id,
      transaction_number: row.transaction_number,
      created_at: row.created_at,
      status,
      claimed_by: state?.claimed_by ?? null,
      started_at: state?.started_at ?? null,
      ready_at: state?.ready_at ?? null,
      items,
    });
  }

  // Oldest first: the kitchen works the queue from the front. The query
  // ordered newest-first only so that the MAX_ROWS cap keeps recent sales.
  tickets.reverse();

  return NextResponse.json({ tickets, server_time: new Date().toISOString() });
}

// ── PATCH ──────────────────────────────────────────────────────────────────
// Body: { transaction_id, from, to, claimed_by? }
//
// `from` is required and checked against what is actually stored. Two stations
// looking at the same board WILL tap the same card; the second one must be
// told the ticket moved rather than silently overwriting the first.
export async function PATCH(request: Request) {
  const resolved = await requireKitchenCaller(request);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId, caller } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const transactionId = body.transaction_id;
  if (typeof transactionId !== "string" || !UUID_RE.test(transactionId)) {
    return bad("transaction_id must be a UUID", 400);
  }
  if (!isTicketStatus(body.from)) return bad("from must be a ticket status", 400);
  if (!isTicketStatus(body.to)) return bad("to must be a ticket status", 400);

  const from = body.from as TicketStatus;
  const to = body.to as TicketStatus;
  if (!canTransition(from, to)) {
    return bad(`Cannot move a ticket from ${from} to ${to}`, 400);
  }

  // The sale must exist AND belong to this store. Scoping here is what stops a
  // forged transaction_id from creating a ticket row against someone else's
  // sale — kitchen_ticket_state.store_id is written from the resolved caller,
  // never from the body.
  const { data: txn, error: txnError } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", transactionId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (txnError) {
    console.error("[Kitchen] Sale lookup failed:", txnError.message);
    return bad("Could not update the ticket", 500);
  }
  // 404 rather than 403 — never confirm that another store's sale exists.
  if (!txn) return bad("Ticket not found", 404);

  const { data: existing, error: stateError } = await supabase
    .from("kitchen_ticket_state")
    .select("status")
    .eq("transaction_id", transactionId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (stateError) {
    console.error("[Kitchen] State lookup failed:", stateError.message);
    return bad("Could not update the ticket", 500);
  }

  // A ticket nobody has touched has no row, and is 'new'.
  const current: TicketStatus =
    existing && isTicketStatus(existing.status) ? existing.status : "new";

  if (current !== from) {
    return NextResponse.json(
      { error: "That ticket has already moved", current },
      { status: 409 }
    );
  }

  const claimedBy =
    typeof body.claimed_by === "string" && body.claimed_by.trim()
      ? body.claimed_by.trim().slice(0, 80)
      : caller.name;

  const patch: Record<string, unknown> = { status: to };
  const stamp = timestampFieldFor(to);
  // Only ever stamped going forward, and only the first time: moving back and
  // forward again must not rewrite when the food was actually ready.
  if (stamp) patch[stamp] = new Date().toISOString();
  if (to === "in_progress") patch.claimed_by = claimedBy;

  // Upsert, because the row may not exist yet — this IS the lazy creation.
  // Conflict target is the primary key, so a race between two stations
  // resolves to one row rather than two.
  const { error: upsertError } = await supabase.from("kitchen_ticket_state").upsert(
    {
      transaction_id: transactionId,
      store_id: storeId,
      ...patch,
    },
    { onConflict: "transaction_id" }
  );

  if (upsertError) {
    console.error("[Kitchen] Update failed:", upsertError.message);
    return bad("Could not update the ticket", 500);
  }

  return NextResponse.json({ transaction_id: transactionId, status: to });
}

// =============================================
// /api/favorites — the till's starred ("frequently used") products
// =============================================
//
// `src/lib/frequentlyUsed.ts` used to read and write `product_favorites` from
// the BROWSER with the public Supabase client. That only worked because
// `NEXT_PUBLIC_SUPABASE_ANON_KEY` currently holds a `service_role` JWT which
// every visitor can read out of the bundle — the same defect login was moved
// off in step 1. A real anon key with RLS on returns nothing for those
// selects, so the key cannot be swapped until reads like these move here.
//
// ## Auth
//
// `resolveCaller()`, as the cash and category routes do: the owner is
// identified positively (session id === store id) and an employee is looked up
// in `store_users`. `x-auth-data` is still an unsigned client header (audit
// P0-1) — this route is no more authenticated than its neighbours, it simply
// no longer needs a database key in the browser.
//
// There is deliberately **no section permission gate**. A star is cosmetic
// per-store display state, the sync engine pulls the list for whoever is
// signed in, and both the till and the inventory screen toggle them — gating
// it would break the quick grid for a cashier without adding a boundary that
// matters. Any authenticated caller of this store, and only their own store.
//
// ## Tenancy
//
// `store_id` comes from the resolved caller on every verb, never from the body
// or the query string. A favourite for another tenant's product is therefore
// not expressible.
//
// ## Offline
//
// The client never blocks on this route: `frequentlyUsed.ts` writes
// localStorage first and queues a `favorite_add` / `favorite_remove` pending
// write when the call fails. Both verbs are idempotent, because a queued write
// that is replayed twice must converge rather than error.
// =============================================

import { NextResponse } from "next/server";
import { readAuthHeader, resolveCaller } from "@/lib/auth/apiCaller";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { bad, callerAndRead } from "@/lib/auth/apiRoute";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres: a unique index rejected the row. */
const UNIQUE_VIOLATION = "23505";

/**
 * Resolve the caller for a WRITE.
 *
 * Sequential, not `callerAndRead()` — that helper overlaps auth with a read on
 * purpose and must never be handed something that writes.
 */
async function requireCaller(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }
  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  const caller = await resolveCaller(supabase, storeId, userId);
  if (!caller) return { error: bad("Unauthorized", 401) };
  return { supabase, storeId };
}

/** A product id from the body or query string. */
function readProductId(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value)) return null;
  return value;
}

// ── GET: the starred ids, newest first ─────────────────────────────────────
export async function GET(request: Request) {
  const resolved = await callerAndRead(request, (supabase, storeId) =>
    supabase
      .from("product_favorites")
      .select("product_id, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
  );
  if ("error" in resolved) return resolved.error;
  const { data, error } = resolved.result;

  if (error) {
    console.error("[Favorites] List failed:", error.message);
    return bad("Could not load favourites", 500);
  }

  const productIds = ((data || []) as { product_id: string }[]).map((row) => row.product_id);
  return NextResponse.json({ product_ids: productIds });
}

// ── POST: star a product ───────────────────────────────────────────────────
// Idempotent: a duplicate is the state the caller asked for, not a failure.
export async function POST(request: Request) {
  const resolved = await requireCaller(request);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const productId = readProductId(body.product_id);
  if (!productId) return bad("product_id must be a UUID", 400);

  const { error } = await supabase
    .from("product_favorites")
    .insert({ store_id: storeId, product_id: productId });

  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error("[Favorites] Add failed:", error.message);
    return bad("Could not save the favourite", 500);
  }

  return NextResponse.json({ ok: true });
}

// ── DELETE: unstar a product ───────────────────────────────────────────────
// Idempotent: deleting a row that is already gone is a success.
export async function DELETE(request: Request) {
  const resolved = await requireCaller(request);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  const productId = readProductId(new URL(request.url).searchParams.get("product_id"));
  if (!productId) return bad("product_id must be a UUID", 400);

  const { error } = await supabase
    .from("product_favorites")
    .delete()
    .eq("store_id", storeId)
    .eq("product_id", productId);

  if (error) {
    console.error("[Favorites] Remove failed:", error.message);
    return bad("Could not remove the favourite", 500);
  }

  return NextResponse.json({ ok: true });
}

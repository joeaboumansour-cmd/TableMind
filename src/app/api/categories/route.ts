// =============================================
// /api/categories — product category CRUD
// =============================================
// Categories are read by the till (to draw the rail) and written from
// inventory. They are ONLINE-ONLY on purpose: creating a category is a
// back-office act, not something that can block a sale, so nothing here
// queues through `pending_writes`. The till only needs to READ them, and it
// reads its own localStorage copy first (see src/lib/categories/store.ts).
//
// ## Auth
//
// Uses `resolveCaller()` — the same pattern as the cash routes, which is the
// most hardened one available today: the owner is identified POSITIVELY
// (session id === store id) and an employee's permissions are looked up in
// `store_users` rather than inferred from a missing field (audit P0-3).
//
// `x-auth-data` is still an unsigned client header (audit P0-1). Closing that
// needs the signed-token work in lib/auth/jwt.ts plus a change to every route
// and every client call — deliberately out of scope here. Do not describe this
// route as authenticated until P0-1 lands.
//
// ## Tenancy
//
// Every query is scoped by `store_id` from the header-resolved caller, never
// from the body. On top of that, migration 029 gives products a COMPOSITE
// foreign key (category_id, store_id) -> product_categories(id, store_id), so
// assigning a category across tenants is impossible in the database itself.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller, canAccessSection } from "@/lib/auth/apiCaller";
import {
  CATEGORY_NAME_MAX,
  CATEGORY_SORT_MAX,
  compareCategories,
  type Category,
} from "@/lib/categories/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres: a row still referenced by a foreign key. */
const FK_VIOLATION = "23503";
/** Postgres: a unique index rejected the row. */
const UNIQUE_VIOLATION = "23505";

const SELECT_COLS = "id, name, sort_order, color";

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Resolve the caller or return the response that should be sent instead.
 * `write` routes additionally require the `inventory` permission — the same
 * permission that gates every other act which changes what a customer sees.
 */
async function requireCaller(request: Request, write: boolean) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }
  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  const caller = await resolveCaller(supabase, storeId, userId);
  if (!caller) return { error: bad("Unauthorized", 401) };
  if (write && !canAccessSection(caller, "inventory")) {
    return { error: bad("Forbidden", 403) };
  }
  return { supabase, storeId, caller };
}

/** Validate a category name, or return the message explaining why not. */
function validateName(value: unknown): string | { error: string } {
  if (typeof value !== "string") return { error: "name is required" };
  const name = value.trim();
  if (!name) return { error: "name is required" };
  if (name.length > CATEGORY_NAME_MAX) {
    return { error: `name must be ${CATEGORY_NAME_MAX} characters or fewer` };
  }
  return name;
}

/** Validate sort_order, or return the message explaining why not. */
function validateSort(value: unknown): number | { error: string } {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > CATEGORY_SORT_MAX) {
    return { error: `sort_order must be a whole number between 0 and ${CATEGORY_SORT_MAX}` };
  }
  return n;
}

/** Validate an optional colour token, or return the message explaining why not. */
function validateColor(value: unknown): string | null | { error: string } {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return { error: "color must be a string" };
  const color = value.trim();
  if (color.length > 32) return { error: "color is too long" };
  return color;
}

// ── GET: the rail ──────────────────────────────────────────────────────────
// Any authenticated caller, including a POS-only cashier: they need the rail
// to sell. Sorting is done with the SAME comparator the client uses, so the
// two can never disagree about order.
export async function GET(request: Request) {
  const resolved = await requireCaller(request, false);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  const { data, error } = await supabase
    .from("product_categories")
    .select(SELECT_COLS)
    .eq("store_id", storeId)
    .eq("is_active", true);

  if (error) {
    console.error("[Categories] List failed:", error.message);
    return bad("Could not load categories", 500);
  }

  const categories = ((data || []) as Category[]).slice().sort(compareCategories);
  return NextResponse.json({ categories });
}

// ── POST: create ───────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const resolved = await requireCaller(request, true);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const name = validateName(body.name);
  if (typeof name !== "string") return bad(name.error, 400);
  const sort = validateSort(body.sort_order);
  if (typeof sort !== "number") return bad(sort.error, 400);
  const color = validateColor(body.color);
  if (color !== null && typeof color !== "string") return bad(color.error, 400);

  const { data, error } = await supabase
    .from("product_categories")
    .insert({ store_id: storeId, name, sort_order: sort, color })
    .select(SELECT_COLS)
    .single();

  if (error) {
    // The partial unique index on (store_id, lower(name)) WHERE is_active.
    if (error.code === UNIQUE_VIOLATION) {
      return bad("A category with that name already exists", 409);
    }
    console.error("[Categories] Create failed:", error.message);
    return bad("Could not create the category", 500);
  }

  return NextResponse.json({ category: data }, { status: 201 });
}

// ── PATCH: rename, recolour, reorder ───────────────────────────────────────
// Accepts either one category, or an `order` array that rewrites sort_order
// for the whole list — a store has tens of categories, so rewriting all of
// them on a drag is cheaper than reasoning about gaps.
export async function PATCH(request: Request) {
  const resolved = await requireCaller(request, true);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  // Bulk reorder.
  if (Array.isArray(body.order)) {
    const ids = body.order;
    if (ids.length > 500) return bad("Too many categories in one request", 400);
    for (const id of ids) {
      if (typeof id !== "string" || !UUID_RE.test(id)) {
        return bad("order must be an array of category UUIDs", 400);
      }
    }
    // Sequential rather than batched: each row needs its own position, and a
    // store has tens of categories. Every statement carries the store scope,
    // so an id belonging to another tenant simply updates nothing.
    for (let i = 0; i < ids.length; i++) {
      const { error } = await supabase
        .from("product_categories")
        .update({ sort_order: i })
        .eq("id", ids[i] as string)
        .eq("store_id", storeId);
      if (error) {
        console.error("[Categories] Reorder failed:", error.message);
        return bad("Could not reorder categories", 500);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const id = body.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return bad("id must be a UUID", 400);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = validateName(body.name);
    if (typeof name !== "string") return bad(name.error, 400);
    patch.name = name;
  }
  if (body.sort_order !== undefined) {
    const sort = validateSort(body.sort_order);
    if (typeof sort !== "number") return bad(sort.error, 400);
    patch.sort_order = sort;
  }
  if (body.color !== undefined) {
    const color = validateColor(body.color);
    if (color !== null && typeof color !== "string") return bad(color.error, 400);
    patch.color = color;
  }
  if (Object.keys(patch).length === 0) return bad("Nothing to update", 400);

  const { data, error } = await supabase
    .from("product_categories")
    .update(patch)
    .eq("id", id)
    .eq("store_id", storeId) // tenancy: another store's category is simply not found
    .eq("is_active", true)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return bad("A category with that name already exists", 409);
    }
    console.error("[Categories] Update failed:", error.message);
    return bad("Could not update the category", 500);
  }
  // 404 for "not yours" as well as "not there" — never leak existence across
  // tenants.
  if (!data) return bad("Category not found", 404);

  return NextResponse.json({ category: data });
}

// ── DELETE: remove, or retire ──────────────────────────────────────────────
// The outcome is NOT a preference, exactly as it is not for a cash register:
//
//   Never used by any product  ->  deleted outright
//   Used by any product        ->  RETIRED (is_active = false), rows kept
//
// products.category_id is ON DELETE RESTRICT (migration 029) precisely so a
// mistake here cannot wipe the category off a shelf full of products. The
// 23503 is the signal to retire, and this route never works around it.
export async function DELETE(request: Request) {
  const resolved = await requireCaller(request, true);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  const id = new URL(request.url).searchParams.get("category_id");
  if (!id || !UUID_RE.test(id)) return bad("category_id must be a UUID", 400);

  const { data: existing } = await supabase
    .from("product_categories")
    .select("id")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();
  if (!existing) return bad("Category not found", 404);

  const { error } = await supabase
    .from("product_categories")
    .delete()
    .eq("id", id)
    .eq("store_id", storeId);

  if (!error) return NextResponse.json({ outcome: "deleted" });

  if (error.code === FK_VIOLATION) {
    const { error: retireError } = await supabase
      .from("product_categories")
      .update({ is_active: false })
      .eq("id", id)
      .eq("store_id", storeId);
    if (retireError) {
      console.error("[Categories] Retire failed:", retireError.message);
      return bad("Could not remove the category", 500);
    }
    return NextResponse.json({ outcome: "retired" });
  }

  console.error("[Categories] Delete failed:", error.message);
  return bad("Could not remove the category", 500);
}

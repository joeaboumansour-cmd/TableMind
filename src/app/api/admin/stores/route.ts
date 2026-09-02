// =============================================
// Store administration for the admin console.
//
// ## Why this route exists at all
//
// /admin/page.tsx used to do every one of these operations from the BROWSER
// with `@/lib/supabase/client`, against a NEXT_PUBLIC key that currently holds
// a service_role JWT. Two separate problems:
//
//   1. Anyone with the bundle has a key that bypasses RLS on every table.
//   2. `handleCreateStore` INSERTED `password_hash` from client code — a store
//      credential typed into a form and posted straight at PostgREST by the
//      page. That is the same class of defect that was taken out of store
//      login; it belongs on the server with everything else.
//
// The list read was `select("*")` on `stores`, so the response carried every
// store's `password_hash` into the admin page's memory. Every query here names
// its columns instead, and `password_hash` is not among them. It is never
// selected, never returned, and never logged — see also
// src/app/api/cash-shifts/route.ts.
//
// ## Authentication
//
// Every verb is gated on `requireAdmin()`. The admin console is cross-tenant by
// design — these queries are deliberately NOT scoped to a store_id — so the
// admin session is the only thing between a caller and the whole fleet. There
// is no till-side caller for any of this (unlike the sibling `features` route,
// whose GET has to serve every shop), so there is no second path in.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/adminSession";
import { FEATURE_PRESETS, getDefaultFeaturesForPreset } from "@/lib/features";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The list columns. `password_hash` is absent on purpose and must stay absent. */
const LIST_COLUMNS = "id, username, license_expires_at, created_at, store_type";

/** The single-store columns — the list plus what the settings dialogs edit. */
const DETAIL_COLUMNS =
  "id, username, license_expires_at, created_at, store_type, phone_whatsapp, address, transaction_retention_days, max_transactions";

/** A retention/limit field: a non-negative integer, or null for "unset". 0 means unlimited. */
function readNullableCount(value: unknown, field: string): number | null | { error: string } {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) {
    return { error: `${field} must be a non-negative integer` };
  }
  return n;
}

/** A date the client typed. Rejected rather than stored as "Invalid Date". */
function readIsoDate(value: unknown, field: string): string | { error: string } {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${field} must be a valid date` };
  }
  return parsed.toISOString();
}

// GET /api/admin/stores            — every store, with the licence counts
// GET /api/admin/stores?store_id=… — one store, including its settings fields
export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof NextResponse) return session;

  try {
    const supabase = await createServiceRoleClient();
    const storeId = new URL(request.url).searchParams.get("store_id");

    if (storeId) {
      if (!UUID_RE.test(storeId)) {
        return NextResponse.json({ error: "store_id must be a UUID" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("stores")
        .select(DETAIL_COLUMNS)
        .eq("id", storeId)
        .single();

      if (error || !data) {
        return NextResponse.json({ error: "Store not found" }, { status: 404 });
      }
      return NextResponse.json({ store: data });
    }

    // The licence tiles used to be `stores.filter(...).length` in the page.
    // That reads the same array the table renders, and PostgREST silently caps
    // an unbounded select at 1,000 rows — so past a thousand stores the
    // headline figures would quietly describe an arbitrary thousand of them.
    // Counted in Postgres instead (`head: true` fetches no rows at all), which
    // is the same rule §11a states for the cash page.
    const nowIso = new Date().toISOString();
    const [list, active, expired] = await Promise.all([
      supabase.from("stores").select(LIST_COLUMNS).order("created_at", { ascending: false }),
      supabase
        .from("stores")
        .select("id", { count: "exact", head: true })
        .gt("license_expires_at", nowIso),
      supabase
        .from("stores")
        .select("id", { count: "exact", head: true })
        .lte("license_expires_at", nowIso),
    ]);

    if (list.error) {
      console.error("Error fetching stores:", list.error);
      return NextResponse.json({ error: "Failed to fetch stores" }, { status: 500 });
    }

    return NextResponse.json({
      stores: list.data ?? [],
      stats: {
        total: (active.count ?? 0) + (expired.count ?? 0),
        active: active.count ?? 0,
        expired: expired.count ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching stores:", error);
    return NextResponse.json({ error: "Failed to fetch stores" }, { status: 500 });
  }
}

// POST /api/admin/stores — create a store account
export async function POST(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof NextResponse) return session;

  try {
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const storeType = typeof body.store_type === "string" ? body.store_type : "general";

    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password are required" },
        { status: 400 }
      );
    }
    if (!FEATURE_PRESETS[storeType]) {
      return NextResponse.json({ error: "Unknown store type" }, { status: 400 });
    }

    const licenseExpiresAt = readIsoDate(body.license_expires_at, "license_expires_at");
    if (typeof licenseExpiresAt !== "string") {
      return NextResponse.json({ error: licenseExpiresAt.error }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from("stores")
      .insert({
        username,
        // The one place a store credential is written. It arrives over the
        // request body and goes straight into the column — it is not echoed
        // back in the response and is not logged, here or in the error branch.
        password_hash: password,
        license_expires_at: licenseExpiresAt,
        store_type: storeType,
        // Derived here rather than taken from the request: the preset is the
        // admin's stated intent, and letting the client post an arbitrary flags
        // object would make the preset dropdown a lie.
        features: getDefaultFeaturesForPreset(storeType),
      })
      .select(LIST_COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Username already exists" }, { status: 409 });
      }
      console.error("Error creating store:", error.code, error.message);
      return NextResponse.json({ error: "Failed to create store" }, { status: 500 });
    }

    return NextResponse.json({ store: data }, { status: 201 });
  } catch (error) {
    console.error("Error creating store:", error);
    return NextResponse.json({ error: "Failed to create store" }, { status: 500 });
  }
}

// PATCH /api/admin/stores — licence renewal, receipt details, retention limits
export async function PATCH(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof NextResponse) return session;

  try {
    const body = await request.json();
    const storeId = typeof body.store_id === "string" ? body.store_id : "";

    if (!UUID_RE.test(storeId)) {
      return NextResponse.json({ error: "store_id must be a UUID" }, { status: 400 });
    }

    // An ALLOWLIST, not a spread of the body. `password_hash`, `username` and
    // `features` are all reachable on this table and none of them belong on a
    // renewal or a receipt-details save; `features` has its own gated route.
    const updates: Record<string, unknown> = {};

    if (body.license_expires_at !== undefined) {
      const iso = readIsoDate(body.license_expires_at, "license_expires_at");
      if (typeof iso !== "string") {
        return NextResponse.json({ error: iso.error }, { status: 400 });
      }
      updates.license_expires_at = iso;
    }
    if (body.phone_whatsapp !== undefined) {
      const value = body.phone_whatsapp;
      updates.phone_whatsapp =
        typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : null;
    }
    if (body.address !== undefined) {
      const value = body.address;
      updates.address =
        typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
    }
    for (const field of ["transaction_retention_days", "max_transactions"] as const) {
      if (body[field] === undefined) continue;
      const count = readNullableCount(body[field], field);
      if (count !== null && typeof count !== "number") {
        return NextResponse.json({ error: count.error }, { status: 400 });
      }
      updates[field] = count;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No data to update" }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    const { data, error } = await supabase
      .from("stores")
      .update(updates)
      .eq("id", storeId)
      .select(DETAIL_COLUMNS)
      .single();

    if (error || !data) {
      if (error && error.code !== "PGRST116") {
        console.error("Error updating store:", error.code, error.message);
        return NextResponse.json({ error: "Failed to update store" }, { status: 500 });
      }
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    return NextResponse.json({ store: data });
  } catch (error) {
    console.error("Error updating store:", error);
    return NextResponse.json({ error: "Failed to update store" }, { status: 500 });
  }
}

// DELETE /api/admin/stores?store_id=… — remove a store and everything under it
export async function DELETE(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof NextResponse) return session;

  try {
    const storeId = new URL(request.url).searchParams.get("store_id");
    if (!storeId || !UUID_RE.test(storeId)) {
      return NextResponse.json({ error: "store_id must be a UUID" }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    const { error } = await supabase.from("stores").delete().eq("id", storeId);

    if (error) {
      console.error("Error deleting store:", error.code, error.message);
      return NextResponse.json({ error: "Failed to delete store" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting store:", error);
    return NextResponse.json({ error: "Failed to delete store" }, { status: 500 });
  }
}

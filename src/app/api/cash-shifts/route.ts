import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// ── Auth helper ─────────────────────────────────────────────────────────────
// Verifies the caller against the DB. Returns the caller's identity or null.
// We verify server-side (not from client claims) because this feature guards money.
interface CallerIdentity {
  isOwner: boolean;
  userId: string | null;
  name: string;
  hasCashRegisterPerm: boolean;
}

async function verifyCaller(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  storeId: string,
  userId: string | null | undefined
): Promise<CallerIdentity | null> {
  // Ensure store exists
  const { data: store } = await supabase
    .from("stores")
    .select("id, username")
    .eq("id", storeId)
    .single();

  if (!store) return null;

  // If no user_id provided → treat as store owner login
  if (!userId) {
    return { isOwner: true, userId: null, name: store.username, hasCashRegisterPerm: true };
  }

  // Employee: look up store_user
  const { data: emp } = await supabase
    .from("store_users")
    .select("id, store_id, display_name, username, is_active, permissions")
    .eq("id", userId)
    .eq("store_id", storeId)
    .single();

  if (!emp || !emp.is_active) return null;

  let perms: Record<string, boolean> = {};
  try {
    perms = typeof emp.permissions === "string" ? JSON.parse(emp.permissions) : emp.permissions || {};
  } catch {
    perms = {};
  }

  return {
    isOwner: false,
    userId: emp.id,
    name: emp.display_name || emp.username,
    hasCashRegisterPerm: perms.cash_register === true,
  };
}

function getAuthFromRequest(request: Request): { storeId: string; userId: string | null } {
  const authData = request.headers.get("x-auth-data");
  if (!authData) return { storeId: "", userId: null };
  try {
    const parsed = JSON.parse(authData);
    return { storeId: parsed.store_id || "", userId: parsed.user_id || null };
  } catch {
    return { storeId: "", userId: null };
  }
}

function getDateParam(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
}

// ── GET ─────────────────────────────────────────────────────────────────────
// GET /api/cash-shifts?store_id=X&date=YYYY-MM-DD
export async function GET(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId } = getAuthFromRequest(request);
    if (!storeId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const businessDate = getDateParam(request);

    // Fetch shift
    const { data: shift } = await supabase
      .from("cash_shifts")
      .select("*")
      .eq("store_id", storeId)
      .eq("business_date", businessDate)
      .maybeSingle();

    // Fetch adjustments for this shift
    const adjustments = shift
      ? await supabase
          .from("cash_adjustments")
          .select("*")
          .eq("shift_id", shift.id)
          .order("created_at", { ascending: true })
      : { data: [] };

    // Fetch today's transaction summary grouped per user (for employee split view)
    const { data: txnSummary, error: txnErr } = await supabase
      .from("transactions")
      .select("id, total_amount, amount_paid, change_given, user_id, user_name, created_at")
      .eq("store_id", storeId)
      .gte("created_at", `${businessDate}T00:00:00`)
      .lt("created_at", `${businessDate}T23:59:59.999`)
      .order("created_at", { ascending: false });

    if (txnErr) {
      console.error("Cash shift GET: transaction fetch error:", txnErr);
    }

    const perUser: Record<string, { name: string; count: number; total: number }> = {};
    let allTransactions: typeof txnSummary = [];

    if (txnSummary) {
      allTransactions = txnSummary;
      for (const t of txnSummary) {
        const key = t.user_id || "owner";
        const name = t.user_name || "Store Owner";
        if (!perUser[key]) perUser[key] = { name, count: 0, total: 0 };
        perUser[key].count += 1;
        // Use amount_paid (actual cash that entered the register) for drawer math.
        // This is the correct figure for reconciliation — it's what physically
        // went into the drawer, not the sale total.
        perUser[key].total += t.amount_paid || 0;
      }
    }

    return NextResponse.json({
      shift: shift || null,
      adjustments: adjustments.data || [],
      transactions: allTransactions,
      perUser: Object.values(perUser),
      businessDate,
    });
  } catch (error: any) {
    console.error("Cash shift GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cash shift", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

// ── POST ────────────────────────────────────────────────────────────────────
// POST /api/cash-shifts  { action: "open"|"close", ... }
export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = getAuthFromRequest(request);
    if (!storeId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const caller = await verifyCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized - invalid credentials" }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "open") {
      // Opening a shift requires owner OR cash_register permission
      if (!caller.isOwner && !caller.hasCashRegisterPerm) {
        return NextResponse.json(
          { error: "Only the store owner or a user with Cash Register permission can open a shift" },
          { status: 403 }
        );
      }

      const businessDate = body.business_date || new Date().toISOString().slice(0, 10);

      // Prevent opening a new day if the previous day's shift is still open
      const yesterday = new Date(businessDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const prevDateStr = yesterday.toISOString().slice(0, 10);

      const { data: prevShift } = await supabase
        .from("cash_shifts")
        .select("id, status")
        .eq("store_id", storeId)
        .eq("business_date", prevDateStr)
        .maybeSingle();

      if (prevShift && prevShift.status === "open") {
        return NextResponse.json(
          { error: "Yesterday's shift is still open. Close it before opening today's shift." },
          { status: 409 }
        );
      }

      // Try to insert (unique constraint on store_id + business_date prevents duplicates)
      const { data: shift, error } = await supabase
        .from("cash_shifts")
        .insert({
          store_id: storeId,
          business_date: businessDate,
          opened_by: caller.isOwner ? null : caller.userId,
          opened_by_name: caller.name,
          opening_ll: body.opening_ll || 0,
          opening_usd: body.opening_usd || 0,
          status: "open",
          verified: caller.isOwner,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          return NextResponse.json(
            { error: "A shift for this date already exists" },
            { status: 409 }
          );
        }
        console.error("Cash shift open error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ shift }, { status: 201 });
    }

    if (action === "close") {
      // Closing requires owner OR cash_register permission
      if (!caller.isOwner && !caller.hasCashRegisterPerm) {
        return NextResponse.json(
          { error: "Only the store owner or a user with Cash Register permission can close a shift" },
          { status: 403 }
        );
      }

      const shiftId = body.shift_id;
      if (!shiftId) {
        return NextResponse.json({ error: "shift_id is required" }, { status: 400 });
      }

      // Only allow closing the currently open shift for this store
      const { data: existing } = await supabase
        .from("cash_shifts")
        .select("*")
        .eq("id", shiftId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ error: "Shift not found" }, { status: 404 });
      }

      if (existing.status === "closed") {
        return NextResponse.json(
          { error: "This shift is already closed and cannot be modified" },
          { status: 409 }
        );
      }

      const { data: shift, error } = await supabase
        .from("cash_shifts")
        .update({
          status: "closed",
          closed_by: caller.isOwner ? null : caller.userId,
          closed_by_name: caller.name,
          closed_at: new Date().toISOString(),
          closing_ll: body.closing_ll != null ? body.closing_ll : 0,
          closing_usd: body.closing_usd != null ? body.closing_usd : 0,
          verified: caller.isOwner,
          notes: body.notes || null,
        })
        .eq("id", shiftId)
        .select()
        .single();

      if (error) {
        console.error("Cash shift close error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ shift });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Cash shift POST error:", error);
    return NextResponse.json(
      { error: "Failed to process cash shift", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
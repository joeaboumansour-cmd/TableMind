import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// ── Auth helper (owner-only for adjustments) ─────────────────────────────────
// Adjustments are owner-only. No employee can add or remove cash from the drawer.

interface CallerIdentity {
  isOwner: boolean;
  userId: string | null;
  name: string;
}

async function verifyOwner(
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

  // No user_id → owner login
  if (!userId) {
    return { isOwner: true, userId: null, name: store.username };
  }

  // Employee: look up store_user
  const { data: emp } = await supabase
    .from("store_users")
    .select("id, store_id, display_name, username, is_active")
    .eq("id", userId)
    .eq("store_id", storeId)
    .single();

  if (!emp || !emp.is_active) return null;

  return {
    isOwner: false,
    userId: emp.id,
    name: emp.display_name || emp.username,
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

// ── POST ─────────────────────────────────────────────────────────────────────
// POST /api/cash-adjustments
// Body: { shift_id, adjustment_type: "cash_in"|"cash_out", amount_ll, amount_usd, reason }
export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = getAuthFromRequest(request);
    if (!storeId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const caller = await verifyOwner(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized - invalid credentials" }, { status: 401 });
    }

    // ONLY the store owner can add adjustments
    if (!caller.isOwner) {
      return NextResponse.json(
        { error: "Only the store owner can record cash adjustments" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { shift_id, adjustment_type, amount_ll, amount_usd, reason } = body;

    if (!shift_id) {
      return NextResponse.json({ error: "shift_id is required" }, { status: 400 });
    }

    if (!adjustment_type || !["cash_in", "cash_out"].includes(adjustment_type)) {
      return NextResponse.json(
        { error: "adjustment_type must be 'cash_in' or 'cash_out'" },
        { status: 400 }
      );
    }

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: "A reason is required for the adjustment" }, { status: 400 });
    }

    const ll = Number(amount_ll) || 0;
    const usd = Number(amount_usd) || 0;
    if (ll <= 0 && usd <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than zero in at least one currency" },
        { status: 400 }
      );
    }

    // Verify the shift belongs to this store
    const { data: shift } = await supabase
      .from("cash_shifts")
      .select("id, status")
      .eq("id", shift_id)
      .eq("store_id", storeId)
      .maybeSingle();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    if (shift.status === "closed") {
      return NextResponse.json(
        { error: "Cannot add adjustments to a closed shift" },
        { status: 409 }
      );
    }

    const { data: adjustment, error } = await supabase
      .from("cash_adjustments")
      .insert({
        store_id: storeId,
        shift_id,
        adjustment_type,
        amount_ll: ll,
        amount_usd: usd,
        reason: reason.trim(),
        created_by: caller.userId, // null = owner
        created_by_name: caller.name,
      })
      .select()
      .single();

    if (error) {
      console.error("Cash adjustment create error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ adjustment }, { status: 201 });
  } catch (error: any) {
    console.error("Cash adjustment POST error:", error);
    return NextResponse.json(
      { error: "Failed to create cash adjustment", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
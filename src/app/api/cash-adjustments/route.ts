// =============================================
// /api/cash-adjustments — owner-only mid-shift cash in/out
// =============================================
// Moved onto the shared resolveCaller() helper, which fixes audit P0-3 here:
// this route previously treated a MISSING `user_id` in the unsigned auth header
// as proof the caller was the store owner, and then gated cash in/out on
// exactly that flag. Any employee could delete one field from the header and
// gain unrestricted authority to remove money from the drawer.
//
// The owner is now identified positively (their session id is the store id).
// A header with no user_id is a 401. See lib/auth/apiCaller.ts for what remains
// unfixed (P0-1: the header is still unsigned and therefore forgeable).
// =============================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { readAuthHeader, resolveCaller } from "@/lib/auth/apiCaller";

const MAX_AMOUNT = 99_999_999_999.99;

function parseAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

// POST /api/cash-adjustments
// Body: { shift_id, adjustment_type: "cash_in"|"cash_out", amount_ll, amount_usd, reason }
export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Adjustments stay owner-only: this is the one action that moves money in
    // or out of the drawer without a sale behind it.
    if (!caller.isOwner) {
      return NextResponse.json(
        { error: "Only the store owner can record cash adjustments" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { shift_id, adjustment_type, reason } = body;

    if (!shift_id || typeof shift_id !== "string") {
      return NextResponse.json({ error: "shift_id is required" }, { status: 400 });
    }

    if (!adjustment_type || !["cash_in", "cash_out"].includes(adjustment_type)) {
      return NextResponse.json(
        { error: "adjustment_type must be 'cash_in' or 'cash_out'" },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json({ error: "A reason is required for the adjustment" }, { status: 400 });
    }

    const ll = parseAmount(body.amount_ll);
    const usd = parseAmount(body.amount_usd);
    if (ll === null || usd === null) {
      return NextResponse.json(
        { error: "Amount must be a non-negative number" },
        { status: 400 }
      );
    }
    if (ll <= 0 && usd <= 0) {
      return NextResponse.json(
        { error: "Amount must be greater than zero in at least one currency" },
        { status: 400 }
      );
    }

    // Scoped by store_id — another tenant's shift reads as 404.
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
        reason: reason.trim().slice(0, 500),
        created_by: caller.userId, // null for the owner
        created_by_name: caller.name,
      })
      .select()
      .single();

    if (error) {
      console.error("Cash adjustment create error:", error.message);
      return NextResponse.json({ error: "Failed to create adjustment" }, { status: 500 });
    }

    return NextResponse.json({ adjustment }, { status: 201 });
  } catch (error) {
    console.error("Cash adjustment POST error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to create cash adjustment" }, { status: 500 });
  }
}

// =============================================
// /api/my-shift — "which drawer am I on?"
// =============================================
// The cashier's own view of their assignment. Deliberately separate from
// /api/cash-shifts, which returns every register in the store and is gated on
// the cash_register permission.
//
// A POS-only cashier has no business seeing the whole store's drawer figures,
// but they do need to know which register their sales are landing in — that is
// the one fact that tells them the supervisor set them up correctly. This route
// returns exactly that and nothing else: no amounts, no other registers, no
// other people.
// =============================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { readAuthHeader, resolveCaller } from "@/lib/auth/apiCaller";

export async function GET(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // The caller's identity comes from resolveCaller, never from the body —
    // otherwise anyone could ask which drawer anyone else is on.
    let query = supabase
      .from("cash_shifts")
      .select("id, register_id, opened_at, business_date, label")
      .eq("store_id", storeId)
      .eq("status", "open")
      .limit(1);

    query = caller.isOwner
      ? query.eq("assigned_to_owner", true)
      : query.eq("assigned_user_id", caller.userId!);

    const { data: shift } = await query.maybeSingle();

    if (!shift) {
      // Not an error. A cashier with no shift assigned still sells; their sales
      // are simply recorded unassigned for the supervisor to sort out.
      return NextResponse.json({ shift: null, register: null });
    }

    const { data: register } = await supabase
      .from("cash_registers")
      .select("id, name")
      .eq("id", shift.register_id)
      .eq("store_id", storeId)
      .maybeSingle();

    return NextResponse.json({ shift, register: register || null });
  } catch (error) {
    console.error("My shift GET error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load your shift" }, { status: 500 });
  }
}

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
//
// ── ONE WAVE, NOT THREE ──────────────────────────────────────────────────────
// This used to take three serial round trips: resolve the caller, then read
// the shift (whose filter depended on the caller), then read the register
// (whose id came from the shift). Measured at ~599ms on the Phase 0.3 boot
// trace — the single slowest call on the till's launch path, for a fact a
// cashier does not need in order to scan anything.
//
// Two changes collapse it to one wave:
//
//   1. The register is EMBEDDED in the shift query. PostgREST can follow
//      cash_shifts.register_id in the same request, so the second trip was
//      never necessary.
//   2. Auth runs ALONGSIDE the read rather than before it, via callerAndRead.
//      The filter previously depended on knowing whether the caller was the
//      owner, so the read had to wait; instead the query asks for BOTH
//      candidate rows — the owner's shift and this user's — and the answer is
//      selected once the caller is known.
//
// That is safe for exactly the reason CLAUDE.md gives for the other routes
// that do it: the read is scoped to the `store_id` the caller is CLAIMING, so
// a failed auth discards a read of their own store and nothing is returned
// before the caller is confirmed.
// =============================================

import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { readAuthHeader } from "@/lib/auth/apiCaller";
import { bad, callerAndRead } from "@/lib/auth/apiRoute";

interface ShiftRow {
  id: string;
  register_id: string;
  opened_at: string;
  business_date: string;
  label: string | null;
  assigned_to_owner: boolean;
  assigned_user_id: string | null;
  cash_registers: { id: string; name: string } | null;
}

export async function GET(request: Request) {
  try {
    // Header parse only — no I/O, so this costs nothing before the wave.
    const { userId } = readAuthHeader(request);

    const outcome = await callerAndRead(request, (supabase, storeId) => {
      let query = supabase
        .from("cash_shifts")
        // The register comes back embedded rather than as a second trip.
        .select("id, register_id, opened_at, business_date, label, assigned_to_owner, assigned_user_id, cash_registers(id, name)")
        .eq("store_id", storeId)
        .eq("status", "open");

      // Ask for both candidates at once. Which one applies is decided below,
      // from the RESOLVED caller — never from the header — so this cannot be
      // used to read someone else's assignment.
      query = userId
        ? query.or(`assigned_to_owner.eq.true,assigned_user_id.eq.${userId}`)
        : query.eq("assigned_to_owner", true);

      return query.limit(2);
    });

    if ("error" in outcome) return outcome.error;

    const { caller, result } = outcome;
    if (result.error) {
      console.error("My shift read error:", result.error.message);
      return bad("Failed to load your shift", 500);
    }

    const rows = (result.data ?? []) as unknown as ShiftRow[];

    // Identity comes from resolveCaller, never from the body or the header —
    // otherwise anyone could ask which drawer anyone else is on.
    const match = caller.isOwner
      ? rows.find((r) => r.assigned_to_owner === true)
      : rows.find((r) => r.assigned_user_id === caller.userId);

    if (!match) {
      // Not an error. A cashier with no shift assigned still sells; their sales
      // are simply recorded unassigned for the supervisor to sort out.
      return NextResponse.json({ shift: null, register: null });
    }

    // Same response shape as before: the embedded register is lifted out, and
    // the two fields used only for matching are not exposed.
    const { cash_registers, assigned_to_owner: _owner, assigned_user_id: _user, ...shift } = match;
    void _owner;
    void _user;

    return NextResponse.json({ shift, register: cash_registers ?? null });
  } catch (error) {
    console.error("My shift GET error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load your shift" }, { status: 500 });
  }
}

// =============================================
// /api/cash-shifts — open, close and read cash shifts
// =============================================
// Rewritten for multi-register (migration 027). Three things changed shape:
//
// 1. GET no longer answers "what is the shift for date X". It answers "what is
//    every register doing right now". The old signature made the midnight bug
//    inevitable: at 00:00 the client asked for a date no shift had yet, got
//    null, and rendered "No Shift Open" over a shift that was still open in the
//    database with uncounted cash in the drawer.
//
// 2. Sales are aggregated by `transactions.shift_id`, not by
//    `created_at::date`. A shift that runs past midnight now reconciles
//    correctly with no special-casing, and two registers cannot mix takings.
//
// 3. The "was yesterday's shift left open?" lookback is gone. It computed
//    business_date - 1, so a shift left open across a two-day closure was
//    invisible to it. The partial unique index
//    `cash_shifts(register_id) WHERE status='open'` is the real guard and has
//    no time horizon.
//
// Nothing here ever closes a shift on its own. An overdue shift stays open and
// is reported as overdue; a closing figure is a physical count, and a machine
// inventing one is how a drawer's variance silently disappears.
// =============================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { readAuthHeader, resolveCaller, canManageRegister } from "@/lib/auth/apiCaller";

/** Money fields must be finite, non-negative, and inside DECIMAL(14,2). */
const MAX_AMOUNT = 99_999_999_999.99;

function parseAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

/** Shape of the rows this route passes through; not the full table type. */
interface ShiftRow {
  id: string;
  register_id: string;
  status: string;
  business_date: string;
  [key: string]: unknown;
}

interface AdjustmentRow {
  id: string;
  shift_id: string;
  [key: string]: unknown;
}

interface ShiftTotalsRow {
  shift_id: string;
  amount_paid: number;
  change_given: number;
  usd_amount_paid: number;
  txn_count: number;
}

// ── GET /api/cash-shifts ────────────────────────────────────────────────────
// Returns every active register with its current shift, that shift's sales
// totals and adjustments, plus the store's unassigned sales for today.
export async function GET(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: registers, error: regErr } = await supabase
      .from("cash_registers")
      .select("*")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (regErr) {
      console.error("Cash shifts GET (registers):", regErr.message);
      return NextResponse.json({ error: "Failed to load registers" }, { status: 500 });
    }

    const registerList = registers || [];
    if (registerList.length === 0) {
      return NextResponse.json({ registers: [], shifts: [], totals: {}, adjustments: {}, unassigned: null });
    }

    const registerIds = registerList.map((r: { id: string }) => r.id);

    // The current shift per register: every open one, plus the most recent
    // closed one so a register that has finished still shows its final count.
    const { data: openShifts } = await supabase
      .from("cash_shifts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "open")
      .in("register_id", registerIds);

    const { data: recentClosed } = await supabase
      .from("cash_shifts")
      .select("*")
      .eq("store_id", storeId)
      .eq("status", "closed")
      .in("register_id", registerIds)
      .order("closed_at", { ascending: false })
      .limit(registerIds.length * 3);

    const openByRegister = new Map<string, ShiftRow>();
    for (const s of openShifts || []) openByRegister.set(s.register_id, s);

    const shifts: ShiftRow[] = [...(openShifts || [])];
    const seenClosed = new Set<string>();
    for (const s of recentClosed || []) {
      if (openByRegister.has(s.register_id)) continue; // an open shift wins
      if (seenClosed.has(s.register_id)) continue; // only the latest
      seenClosed.add(s.register_id);
      shifts.push(s);
    }

    const shiftIds = shifts.map((s) => s.id);

    // Aggregate sales in Postgres. Summing in JS would silently truncate at
    // PostgREST's 1000-row cap and under-report a busy shift's drawer.
    const totals: Record<string, ShiftTotalsRow> = {};
    if (shiftIds.length > 0) {
      const { data: totalRows, error: totalsErr } = await supabase.rpc("get_shift_totals", {
        p_store_id: storeId,
        p_shift_ids: shiftIds,
      });
      if (totalsErr) {
        console.error("Cash shifts GET (totals):", totalsErr.message);
        return NextResponse.json({ error: "Failed to total shift sales" }, { status: 500 });
      }
      for (const row of (totalRows as ShiftTotalsRow[]) || []) {
        totals[row.shift_id] = row;
      }
    }

    // Adjustments for the shifts on screen.
    const adjustments: Record<string, AdjustmentRow[]> = {};
    if (shiftIds.length > 0) {
      const { data: adjRows } = await supabase
        .from("cash_adjustments")
        .select("*")
        .eq("store_id", storeId)
        .in("shift_id", shiftIds)
        .order("created_at", { ascending: true });

      for (const a of adjRows || []) {
        (adjustments[a.shift_id] ||= []).push(a);
      }
    }

    // Pending approval requests, counted per register for the card badges.
    const pendingByRegister: Record<string, number> = {};
    const { data: pendingRows } = await supabase
      .from("register_requests")
      .select("register_id")
      .eq("store_id", storeId)
      .eq("status", "pending");
    for (const r of pendingRows || []) {
      pendingByRegister[r.register_id] = (pendingByRegister[r.register_id] || 0) + 1;
    }

    // Sales today that reached no shift — a device with no register configured,
    // or one selling while its register had nothing open. Surfaced because a
    // non-zero figure here means a till is misconfigured, not that money is
    // missing.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const { data: unassignedRows } = await supabase
      .from("transactions")
      .select("amount_paid, change_given")
      .eq("store_id", storeId)
      .is("shift_id", null)
      .gte("created_at", startOfToday.toISOString())
      .limit(1000);

    const unassigned = {
      count: (unassignedRows || []).length,
      total: (unassignedRows || []).reduce(
        (s: number, t: { amount_paid: number | null; change_given: number | null }) =>
          s + (t.amount_paid || 0) - (t.change_given || 0),
        0
      ),
      /** True when the 1000-row cap may have clipped the list — display hint only. */
      truncated: (unassignedRows || []).length >= 1000,
    };

    return NextResponse.json({
      registers: registerList,
      shifts,
      totals,
      adjustments,
      pendingByRegister,
      unassigned,
    });
  } catch (error) {
    console.error("Cash shifts GET error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load cash registers" }, { status: 500 });
  }
}

// ── POST /api/cash-shifts ───────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    // ── Open ────────────────────────────────────────────────────────────────
    if (action === "open") {
      if (!canManageRegister(caller)) {
        return NextResponse.json(
          { error: "Only the store owner or a user with Cash Register permission can open a shift" },
          { status: 403 }
        );
      }

      const registerId = typeof body.register_id === "string" ? body.register_id : "";
      if (!registerId) {
        return NextResponse.json({ error: "register_id is required" }, { status: 400 });
      }

      const openingLl = parseAmount(body.opening_ll);
      const openingUsd = parseAmount(body.opening_usd);
      if (openingLl === null || openingUsd === null) {
        return NextResponse.json(
          { error: "Opening float must be a non-negative amount" },
          { status: 400 }
        );
      }

      // Scoped by store_id — another tenant's register reads as 404.
      const { data: register } = await supabase
        .from("cash_registers")
        .select("id, name, is_active")
        .eq("id", registerId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (!register || !register.is_active) {
        return NextResponse.json({ error: "Register not found" }, { status: 404 });
      }

      // Replaces the old business_date - 1 lookback: this finds an abandoned
      // shift however long ago it was opened.
      const { data: alreadyOpen } = await supabase
        .from("cash_shifts")
        .select("*")
        .eq("register_id", registerId)
        .eq("status", "open")
        .maybeSingle();

      if (alreadyOpen) {
        return NextResponse.json(
          {
            error: `"${register.name}" still has a shift open from ${alreadyOpen.business_date}. Count and close it before opening a new one — that cash is still in the drawer.`,
            open_shift: alreadyOpen,
          },
          { status: 409 }
        );
      }

      const now = new Date();
      const businessDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim().slice(0, 60)
          : null;

      const { data: shift, error } = await supabase
        .from("cash_shifts")
        .insert({
          store_id: storeId,
          register_id: registerId,
          // A label for the day it opened. NOT the shift's identity or bounds —
          // those are opened_at / closed_at.
          business_date: businessDate,
          label,
          opened_by: caller.userId,
          opened_by_name: caller.name,
          opening_ll: openingLl,
          opening_usd: openingUsd,
          status: "open",
          verified: caller.isOwner,
        })
        .select()
        .single();

      if (error) {
        // The partial unique index caught a race between two devices.
        if (error.code === "23505") {
          return NextResponse.json(
            { error: "A shift was just opened on this register from another device" },
            { status: 409 }
          );
        }
        console.error("Cash shift open error:", error.message);
        return NextResponse.json({ error: "Failed to open shift" }, { status: 500 });
      }

      return NextResponse.json({ shift }, { status: 201 });
    }

    // ── Close ───────────────────────────────────────────────────────────────
    if (action === "close") {
      if (!canManageRegister(caller)) {
        return NextResponse.json(
          { error: "Only the store owner or a user with Cash Register permission can close a shift" },
          { status: 403 }
        );
      }

      const shiftId = typeof body.shift_id === "string" ? body.shift_id : "";
      if (!shiftId) {
        return NextResponse.json({ error: "shift_id is required" }, { status: 400 });
      }

      const closingLl = parseAmount(body.closing_ll);
      const closingUsd = parseAmount(body.closing_usd);
      if (closingLl === null || closingUsd === null) {
        return NextResponse.json(
          { error: "Counted amount must be a non-negative amount" },
          { status: 400 }
        );
      }

      const { data: existing } = await supabase
        .from("cash_shifts")
        .select("*")
        .eq("id", shiftId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ error: "Shift not found" }, { status: 404 });
      }

      // Idempotent under retry: the offline queue may push a close twice. The
      // second is reported as already-closed rather than overwriting a count.
      if (existing.status === "closed") {
        return NextResponse.json(
          { error: "This shift is already closed and cannot be modified", shift: existing },
          { status: 409 }
        );
      }

      const { data: shift, error } = await supabase
        .from("cash_shifts")
        .update({
          status: "closed",
          closed_by: caller.userId,
          closed_by_name: caller.name,
          closed_at: new Date().toISOString(),
          closing_ll: closingLl,
          closing_usd: closingUsd,
          verified: caller.isOwner,
          notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
        })
        .eq("id", shiftId)
        .eq("store_id", storeId)
        .eq("status", "open") // do not reopen-and-overwrite a concurrent close
        .select()
        .single();

      if (error) {
        console.error("Cash shift close error:", error.message);
        return NextResponse.json({ error: "Failed to close shift" }, { status: 500 });
      }

      return NextResponse.json({ shift });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Cash shift POST error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to process cash shift" }, { status: 500 });
  }
}

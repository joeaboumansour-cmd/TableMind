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

/**
 * What `get_cash_overview` (migration 039) returns.
 *
 * Deliberately the SAME shapes the three-wave path builds by hand, so the two
 * code paths cannot serve subtly different JSON to the same screen.
 */
interface CashOverview {
  shifts: ShiftRow[];
  totals: Record<string, ShiftTotalsRow>;
  adjustments: Record<string, AdjustmentRow[]>;
}

// ── GET /api/cash-shifts ────────────────────────────────────────────────────
// Every active register with its current shift, that shift's sales totals and
// adjustments, the pending approval counts, the assignable employees, and the
// store's unassigned takings for today.
//
// ## Why this is written as three waves
//
// It used to be ten `await`s in a row. Each one is a separate round trip to
// Supabase, so the page paid the full network latency ten times over before it
// could render anything — and the cash page fires two other requests alongside
// this one. That was most of an eight-second load.
//
// There are only two genuine data dependencies here: you need the register ids
// before you can ask about their shifts, and the shift ids before you can total
// their sales. Everything else is independent and now runs concurrently.
//
// Keep it that way. If you add a query, put it in the wave whose inputs it
// actually needs rather than appending another serial await.
export async function GET(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    // "Today" has to mean the SHOP's today, not the server's.
    //
    // This used to be `new Date(); setHours(0,0,0,0)` evaluated on Vercel,
    // which runs in UTC, against a store in UTC+3 — so the window sat three
    // hours off the shop's day, precisely around the hours a drawer is counted
    // and closed. The till knows its own timezone, so it sends its local
    // midnight and the server trusts it only as far as it is sane: a real
    // date, and within a day either side of the server's own idea of now.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const fromParam = new URL(request.url).searchParams.get("from");
    if (fromParam) {
      const parsed = new Date(fromParam);
      const skewMs = Math.abs(parsed.getTime() - startOfToday.getTime());
      if (!Number.isNaN(parsed.getTime()) && skewMs <= 36 * 60 * 60 * 1000) {
        startOfToday.setTime(parsed.getTime());
      }
    }

    // ── Wave 1 ───────────────────────────────────────────────────────────────
    // Auth runs alongside the store-scoped reads rather than in front of them.
    // Nothing is returned until the caller is confirmed below; this only
    // overlaps the latency. All of these are already scoped to storeId, so a
    // failed auth discards them without ever having read another tenant.
    const [caller, registersRes, employeesRes, pendingRes, unassignedRes, overviewRes] = await Promise.all([
      resolveCaller(supabase, storeId, userId),
      supabase
        .from("cash_registers")
        .select("*")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      // The people a shift can be assigned to, for the Open Shift dialog.
      // password_hash is NOT selected. It must never leave the database.
      supabase
        .from("store_users")
        .select("id, username, display_name, permissions")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
      supabase
        .from("register_requests")
        .select("register_id")
        .eq("store_id", storeId)
        .eq("status", "pending"),
      supabase.rpc("get_unassigned_totals", {
        p_store_id: storeId,
        p_from: startOfToday.toISOString(),
      }),
      // The whole register → shift → totals traversal, done in Postgres.
      //
      // Waves 2 and 3 below exist only because each needed the ids the previous
      // one produced, so this endpoint paid full network latency THREE times —
      // 849 ms measured, against a ~300 ms one-round-trip floor. Postgres
      // already has all three in one place (migration 039).
      //
      // Started HERE, in wave 1, because it needs nothing from it: it takes the
      // store id and does its own traversal. So the success path is one wave,
      // total.
      supabase.rpc("get_cash_overview", { p_store_id: storeId }),
    ]);

    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (registersRes.error) {
      console.error("Cash shifts GET (registers):", registersRes.error.message);
      return NextResponse.json({ error: "Failed to load registers" }, { status: 500 });
    }

    const registerList = (registersRes.data || []) as Array<{ id: string }>;

    // Sales today that reached no shift — a cashier selling with nothing
    // assigned to them. Surfaced because a non-zero figure means a person is
    // misconfigured, not that money is missing.
    //
    // `null` means "could not be computed", and is NOT the same as zero. This
    // used to be `Number(row?.txn_count) || 0`, which turned an RPC failure
    // into a confident "nothing unaccounted" — the one answer that stops
    // anybody looking. A figure whose whole job is to say money went astray
    // must never fail closed and silent.
    let unassigned: { count: number; total: number } | null = null;
    if (unassignedRes.error) {
      console.error(
        "Cash shifts GET (get_unassigned_totals):",
        unassignedRes.error.message
      );
    } else {
      const unassignedRow = (unassignedRes.data as Array<{
        txn_count: number;
        total: number;
      }> | null)?.[0];
      unassigned = {
        count: Number(unassignedRow?.txn_count) || 0,
        total: Number(unassignedRow?.total) || 0,
      };
    }

    const pendingByRegister: Record<string, number> = {};
    for (const r of (pendingRes.data || []) as Array<{ register_id: string }>) {
      pendingByRegister[r.register_id] = (pendingByRegister[r.register_id] || 0) + 1;
    }

    if (registerList.length === 0) {
      return NextResponse.json({
        registers: [],
        employees: employeesRes.data || [],
        shifts: [],
        totals: {},
        adjustments: {},
        pendingByRegister,
        unassigned,
      });
    }

    const registerIds = registerList.map((r) => r.id);

    // ── The fast path: migration 039 answered, and waves 2 and 3 are skipped ──
    //
    // `registers` still comes from wave 1's own query rather than from the RPC,
    // so that list is byte-identical to what it has always been and the change
    // is confined to the parts that were costing round trips.
    const overview = overviewRes.error ? null : (overviewRes.data as CashOverview | null);
    if (overviewRes.error) {
      // NOT fatal, and deliberately loud. A database without 039 applied is the
      // expected state until somebody runs it — the same compatibility hinge
      // migration 037 has for `decrement_stock_batch`. The drawer figures below
      // are the ones that were always there.
      console.warn(
        "[Cash] get_cash_overview unavailable, falling back to the three-wave path:",
        overviewRes.error.message
      );
    }

    if (overview) {
      return NextResponse.json({
        registers: registersRes.data || [],
        employees: employeesRes.data || [],
        shifts: overview.shifts || [],
        totals: overview.totals || {},
        adjustments: overview.adjustments || {},
        pendingByRegister,
        unassigned,
      });
    }

    // ── Wave 2 ───────────────────────────────────────────────────────────────
    // Needs the register ids. The current shift per register: every open one,
    // plus recent closed ones so a finished register still shows its last count.
    const [openRes, closedRes] = await Promise.all([
      supabase
        .from("cash_shifts")
        .select("*")
        .eq("store_id", storeId)
        .eq("status", "open")
        .in("register_id", registerIds),
      supabase
        .from("cash_shifts")
        .select("*")
        .eq("store_id", storeId)
        .eq("status", "closed")
        .in("register_id", registerIds)
        .order("closed_at", { ascending: false })
        .limit(registerIds.length * 3),
    ]);

    const openShifts = (openRes.data || []) as ShiftRow[];
    const openByRegister = new Map<string, ShiftRow>();
    for (const sh of openShifts) openByRegister.set(sh.register_id, sh);

    const shifts: ShiftRow[] = [...openShifts];
    const seenClosed = new Set<string>();
    for (const sh of (closedRes.data || []) as ShiftRow[]) {
      if (openByRegister.has(sh.register_id)) continue; // an open shift wins
      if (seenClosed.has(sh.register_id)) continue; // only the latest
      seenClosed.add(sh.register_id);
      shifts.push(sh);
    }

    const shiftIds = shifts.map((sh) => sh.id);

    const totals: Record<string, ShiftTotalsRow> = {};
    const adjustments: Record<string, AdjustmentRow[]> = {};

    if (shiftIds.length > 0) {
      // ── Wave 3 ─────────────────────────────────────────────────────────────
      // Needs the shift ids. Sales are aggregated in Postgres: summing a select
      // in JS would silently stop at PostgREST's 1000-row cap and under-report
      // exactly the busiest shift.
      const [totalsRes, adjRes] = await Promise.all([
        supabase.rpc("get_shift_totals", { p_store_id: storeId, p_shift_ids: shiftIds }),
        supabase
          .from("cash_adjustments")
          .select("*")
          .eq("store_id", storeId)
          .in("shift_id", shiftIds)
          .order("created_at", { ascending: true }),
      ]);

      if (totalsRes.error) {
        console.error("Cash shifts GET (totals):", totalsRes.error.message);
        return NextResponse.json({ error: "Failed to total shift sales" }, { status: 500 });
      }

      for (const row of (totalsRes.data as ShiftTotalsRow[]) || []) {
        totals[row.shift_id] = row;
      }
      for (const a of (adjRes.data || []) as AdjustmentRow[]) {
        (adjustments[a.shift_id] ||= []).push(a);
      }
    }

    return NextResponse.json({
      registers: registersRes.data || [],
      employees: employeesRes.data || [],
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

      // ── Who is working this drawer ────────────────────────────────────────
      // "owner" | <store_users.id> | omitted (leave unassigned for now).
      //
      // Until someone is assigned, that register's sales cannot be attributed —
      // nobody is linked to it — so they land in the Unassigned bucket. That is
      // a deliberate, visible state rather than a blocked one: a supervisor
      // mid-setup must not stop the shop selling.
      const assignee = body.assigned_user_id;
      let assignedUserId: string | null = null;
      let assignedToOwner = false;
      let assignedUserName: string | null = null;

      if (assignee === "owner") {
        assignedToOwner = true;
        assignedUserName = caller.isOwner ? caller.name : "Store Owner";
      } else if (typeof assignee === "string" && assignee) {
        // Scoped by store_id: a supervisor cannot put another tenant's employee
        // on their drawer.
        const { data: emp } = await supabase
          .from("store_users")
          .select("id, username, display_name, is_active")
          .eq("id", assignee)
          .eq("store_id", storeId)
          .maybeSingle();

        if (!emp || !emp.is_active) {
          return NextResponse.json(
            { error: "That user is not an active member of this store" },
            { status: 400 }
          );
        }
        assignedUserId = emp.id;
        assignedUserName = emp.display_name || emp.username;
      }

      // A cashier can only be on one drawer at a time. Checked here so the
      // supervisor gets a sentence naming the clash, rather than a raw 23505
      // from the unique index behind it.
      if (assignedUserId || assignedToOwner) {
        let clashQuery = supabase
          .from("cash_shifts")
          .select("id, register_id")
          .eq("store_id", storeId)
          .eq("status", "open");
        clashQuery = assignedUserId
          ? clashQuery.eq("assigned_user_id", assignedUserId)
          : clashQuery.eq("assigned_to_owner", true);

        const { data: clash } = await clashQuery.maybeSingle();
        if (clash) {
          const { data: clashRegister } = await supabase
            .from("cash_registers")
            .select("name")
            .eq("id", clash.register_id)
            .maybeSingle();
          return NextResponse.json(
            {
              error: `${assignedUserName} is already on ${clashRegister?.name || "another register"}. Close that shift first.`,
            },
            { status: 409 }
          );
        }
      }

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
          assigned_user_id: assignedUserId,
          assigned_to_owner: assignedToOwner,
          assigned_user_name: assignedUserName,
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

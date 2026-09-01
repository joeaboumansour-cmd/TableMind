// =============================================
// /api/cash-registers — the durable, named drawers
// =============================================
// A register is permanent; a shift is one accountable period ON a register.
// Keeping the name on the register rather than on the shift is what lets the
// name survive a close, which the approval-request feature depends on: a
// request is addressed to "Front Counter", not to whichever shift happened to
// be open when it was raised.
//
// Auth is via resolveCaller() — see lib/auth/apiCaller.ts for what that does
// and does not guarantee (it fixes audit P0-3, not P0-1).
// =============================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { readAuthHeader, resolveCaller, canManageRegister } from "@/lib/auth/apiCaller";
import { callerAndRead } from "@/lib/auth/apiRoute";

const MAX_NAME_LENGTH = 40;
/** A store with more drawers than this has almost certainly hit a bug or a script. */
const MAX_REGISTERS_PER_STORE = 20;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

// ── GET /api/cash-registers ─────────────────────────────────────────────────
// Every active register for the store, ordered for display.
export async function GET(request: Request) {
  try {
    // Auth runs ALONGSIDE the read, not before it. The read is scoped to the
    // `store_id` the caller is CLAIMING, so a failed auth discards a read of
    // their own store and nothing is returned before the caller is confirmed —
    // the pattern GET /api/cash-shifts already uses.
    const outcome = await callerAndRead(request, (client, storeId) =>
      client
        .from("cash_registers")
        .select("*")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    );

    if ("error" in outcome) return outcome.error;
    const { data, error } = outcome.result;

    if (error) {
      console.error("Cash registers GET error:", error.message);
      return NextResponse.json({ error: "Failed to load registers" }, { status: 500 });
    }

    return NextResponse.json({ registers: data || [] });
  } catch (error) {
    console.error("Cash registers GET error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load registers" }, { status: 500 });
  }
}

// ── POST /api/cash-registers ────────────────────────────────────────────────
// Create a register. Online-only by design — see the offline note in the plan:
// a register is a piece of shared configuration, not a money event, and two
// devices inventing "Front Counter" while offline would produce two drawers
// that then have to be merged by hand.
export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageRegister(caller)) {
      return NextResponse.json(
        { error: "Only the store owner or a user with Cash Register permission can add a register" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = cleanName(body?.name);
    if (!name) {
      return NextResponse.json(
        { error: `Give the register a name of 1–${MAX_NAME_LENGTH} characters` },
        { status: 400 }
      );
    }

    const { count } = await supabase
      .from("cash_registers")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("is_active", true);

    if ((count ?? 0) >= MAX_REGISTERS_PER_STORE) {
      return NextResponse.json(
        { error: `A store can have at most ${MAX_REGISTERS_PER_STORE} registers` },
        { status: 400 }
      );
    }

    // The client may supply the id. That is how a register created during an
    // outage keeps its identity: a queued cash_shift_open already refers to
    // this id, so the shift's reference must still be valid once the register
    // lands. It also makes this call idempotent — a retried push finds the row
    // already there instead of creating a second drawer.
    const clientId = typeof body?.id === "string" && body.id ? body.id : null;

    if (clientId) {
      const { data: already } = await supabase
        .from("cash_registers")
        .select("*")
        .eq("id", clientId)
        .eq("store_id", storeId)
        .maybeSingle();

      if (already) {
        return NextResponse.json({ register: already, duplicated: true });
      }
    }

    // A name collision must not lose the drawer. Two supervisors offline can
    // both invent "Front Counter", and the second one's register still holds a
    // real shift with real money pointing at it — so it is admitted under a
    // disambiguated name for someone to rename later, rather than rejected.
    //
    // An interactive create (no client id) still gets a plain 409: there is a
    // person watching who can simply pick another name.
    let finalName = name;

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from("cash_registers")
        .insert({
          ...(clientId && { id: clientId }),
          store_id: storeId,
          name: finalName,
          sort_order: count ?? 0,
          created_by: caller.userId,
          created_by_name: caller.name,
        })
        .select()
        .single();

      if (!error) {
        return NextResponse.json({ register: data }, { status: 201 });
      }

      // Partial unique index on (store_id, lower(name)) where is_active.
      if (error.code !== "23505") {
        console.error("Cash register create error:", error.message);
        return NextResponse.json({ error: "Failed to create register" }, { status: 500 });
      }

      if (!clientId) {
        return NextResponse.json(
          { error: `There is already a register called "${name}"` },
          { status: 409 }
        );
      }

      finalName = `${name} (${attempt + 2})`;
    }

    return NextResponse.json(
      { error: `Could not find a free name for "${name}"` },
      { status: 409 }
    );
  } catch (error) {
    console.error("Cash register POST error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to create register" }, { status: 500 });
  }
}

// ── PATCH /api/cash-registers ───────────────────────────────────────────────
// Rename, or retire. Retiring is a soft delete: shifts FK to the register with
// ON DELETE RESTRICT precisely so a drawer's counted history cannot be erased
// by tidying up the register list.
export async function PATCH(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageRegister(caller)) {
      return NextResponse.json(
        { error: "Only the store owner or a user with Cash Register permission can edit a register" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const registerId = typeof body?.register_id === "string" ? body.register_id : "";
    if (!registerId) {
      return NextResponse.json({ error: "register_id is required" }, { status: 400 });
    }

    // Scoped by store_id: a register belonging to another tenant reads as 404,
    // so this route cannot be used to probe for other stores' ids.
    const { data: existing } = await supabase
      .from("cash_registers")
      .select("id, name")
      .eq("id", registerId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Register not found" }, { status: 404 });
    }

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) {
        return NextResponse.json(
          { error: `Give the register a name of 1–${MAX_NAME_LENGTH} characters` },
          { status: 400 }
        );
      }
      update.name = name;
    }

    if (body.is_active === false) {
      // Refuse to retire a drawer that still holds an uncounted shift. The cash
      // is physically there; hiding the register would hide the money.
      const { data: openShift } = await supabase
        .from("cash_shifts")
        .select("id")
        .eq("register_id", registerId)
        .eq("status", "open")
        .maybeSingle();

      if (openShift) {
        return NextResponse.json(
          { error: "Close and count this register's open shift before retiring it" },
          { status: 409 }
        );
      }
      update.is_active = false;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("cash_registers")
      .update(update)
      .eq("id", registerId)
      .eq("store_id", storeId)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Another register already uses that name" },
          { status: 409 }
        );
      }
      console.error("Cash register update error:", error.message);
      return NextResponse.json({ error: "Failed to update register" }, { status: 500 });
    }

    return NextResponse.json({ register: data });
  } catch (error) {
    console.error("Cash register PATCH error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to update register" }, { status: 500 });
  }
}

// ── DELETE /api/cash-registers?register_id=… ────────────────────────────────
// Remove a register. Which removal you get depends on whether the drawer has
// ever been counted, and that is not a preference — it is the difference
// between tidying up a typo and destroying money history.
//
//   never used (no shifts)  -> deleted outright
//   has shift history       -> RETIRED (is_active = false), rows kept
//   has an open shift       -> refused; count and close it first
//
// The caller is told which of these happened. `cash_shifts.register_id` is
// declared ON DELETE RESTRICT precisely so a mistake here cannot cascade a
// drawer's counted history away, and this route never works around that.
export async function DELETE(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canManageRegister(caller)) {
      return NextResponse.json(
        { error: "Only the store owner or a user with Cash Register permission can remove a register" },
        { status: 403 }
      );
    }

    const registerId = new URL(request.url).searchParams.get("register_id") || "";
    if (!registerId) {
      return NextResponse.json({ error: "register_id is required" }, { status: 400 });
    }

    // Scoped by store_id — another tenant's register reads as 404, so this
    // cannot be used to probe for or delete other stores' drawers.
    const { data: register } = await supabase
      .from("cash_registers")
      .select("id, name")
      .eq("id", registerId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (!register) {
      return NextResponse.json({ error: "Register not found" }, { status: 404 });
    }

    // The cash is physically in this drawer. Removing the register would hide
    // it rather than account for it.
    const { data: openShift } = await supabase
      .from("cash_shifts")
      .select("id")
      .eq("register_id", registerId)
      .eq("status", "open")
      .maybeSingle();

    if (openShift) {
      return NextResponse.json(
        { error: `"${register.name}" still has an open shift. Count and close it before removing the register.` },
        { status: 409 }
      );
    }

    const { count: shiftCount } = await supabase
      .from("cash_shifts")
      .select("id", { count: "exact", head: true })
      .eq("register_id", registerId);

    const { count: requestCount } = await supabase
      .from("register_requests")
      .select("id", { count: "exact", head: true })
      .eq("register_id", registerId)
      .eq("status", "pending");

    // Anything ever counted here, or anyone still waiting on an answer from
    // this drawer, means retire rather than delete.
    if ((shiftCount ?? 0) > 0 || (requestCount ?? 0) > 0) {
      const { error } = await supabase
        .from("cash_registers")
        .update({ is_active: false })
        .eq("id", registerId)
        .eq("store_id", storeId);

      if (error) {
        console.error("Cash register retire error:", error.message);
        return NextResponse.json({ error: "Failed to retire register" }, { status: 500 });
      }

      return NextResponse.json({
        retired: true,
        shifts: shiftCount ?? 0,
        message: `"${register.name}" has ${shiftCount} counted shift${shiftCount === 1 ? "" : "s"} behind it, so it was retired rather than deleted. It is gone from the cash page and its history is intact.`,
      });
    }

    const { error } = await supabase
      .from("cash_registers")
      .delete()
      .eq("id", registerId)
      .eq("store_id", storeId);

    if (error) {
      // 23503: something still references it that the checks above did not
      // anticipate. Retiring is always safe, so fall back rather than fail.
      if (error.code === "23503") {
        await supabase
          .from("cash_registers")
          .update({ is_active: false })
          .eq("id", registerId)
          .eq("store_id", storeId);
        return NextResponse.json({
          retired: true,
          shifts: 0,
          message: `"${register.name}" was retired rather than deleted — something still refers to it.`,
        });
      }
      console.error("Cash register delete error:", error.message);
      return NextResponse.json({ error: "Failed to remove register" }, { status: 500 });
    }

    return NextResponse.json({
      retired: false,
      message: `"${register.name}" was never used, so it was deleted.`,
    });
  } catch (error) {
    console.error("Cash register DELETE error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to remove register" }, { status: 500 });
  }
}

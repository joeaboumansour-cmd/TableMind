// =============================================
// /api/register-requests — cashier asks, responsible person decides
// =============================================
// The route shape for the approval flow, built now so the later feature (a
// cashier asking to refund an already-sold item) only has to POST here.
//
// GET is what the cash page polls; PATCH records a decision. POST is live too,
// so the flow can be exercised end to end.
//
// A request MAY expire on its own, unlike a shift. Expiry withholds a
// permission, and withholding is the safe direction. Auto-closing a shift would
// instead fabricate a money figure nobody counted, which is why nothing in this
// codebase does that.
// =============================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse, after } from "next/server";
import { errorMessage } from "@/lib/errors";
import { readAuthHeader, resolveCaller, canManageRegister } from "@/lib/auth/apiCaller";
import { callerAndRead } from "@/lib/auth/apiRoute";

const REQUEST_KINDS = [
  "refund_sold_item",
  "price_override",
  "void_line",
  "discount_override",
  "cash_out",
] as const;

/** How long a pending request stays actionable before it lapses. */
const REQUEST_TTL_MINUTES = 15;

/**
 * Persist the lapse of anything past its expiry.
 *
 * Done on read rather than by a scheduled job: the only thing that cares is the
 * poll that is running right now, and a stale row is harmless until someone
 * looks at it.
 *
 * It no longer runs BEFORE the read — see the GET below. Expiry is derivable
 * from `expires_at`, so the read applies it directly and this write is
 * bookkeeping for the other views rather than a prerequisite for a correct
 * answer.
 */
async function expireStale(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  storeId: string
): Promise<void> {
  const { error } = await supabase
    .from("register_requests")
    .update({ status: "expired" })
    .eq("store_id", storeId)
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
  if (error) console.error("Register requests expire error:", error.message);
}

// ── GET /api/register-requests?status=pending ───────────────────────────────
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "pending";
    const now = new Date().toISOString();

    // THREE serial round trips became ONE — 838 ms measured, against a ~300 ms
    // floor, on a panel that polls.
    //
    // §2.2 declined to convert this route, and was right about the reason: its
    // GET ran `expireStale()`, a WRITE, before the read, and racing auth
    // against a write means writing to a store before confirming the caller
    // owns it. That trade is not worth any amount of latency.
    //
    // What changed is that the write stopped being a prerequisite. Expiry is
    // DERIVABLE — a pending request is lapsed exactly when `expires_at` has
    // passed — so the read applies it directly and returns the same rows the
    // write-then-read produced. `expireStale` is now bookkeeping for the other
    // views, and runs AFTER the response via `after()`, so it neither delays
    // the answer nor gets dropped when the function returns.
    //
    // The read is scoped to the `store_id` the caller is CLAIMING, so a failed
    // auth discards a read of their own store — the established rule, now
    // applicable because nothing is written before the caller is known.
    const resolved = await callerAndRead(request, (supabase, storeId) => {
      let query = supabase
        .from("register_requests")
        .select("*, cash_registers(name)")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (status !== "all") query = query.eq("status", status);

      // `expires_at` is NOT NULL per migration 027, but the repo is not a
      // reliable description of production, so a null is treated the way the
      // old write treated it: `.lt("expires_at", now)` never matched a null, so
      // such a row was never lapsed and still showed. This keeps that.
      if (status === "pending") {
        query = query.or(`expires_at.is.null,expires_at.gte.${now}`);
      }

      return query;
    });
    if ("error" in resolved) return resolved.error;

    const { storeId, result } = resolved;
    const { data, error } = result;

    // Persist the lapse only once the caller is confirmed, and only after the
    // response — never before the read that no longer depends on it.
    if (status === "pending") {
      after(async () => {
        const supabase = await createServiceRoleClient();
        await expireStale(supabase, storeId);
      });
    }

    if (error) {
      console.error("Register requests GET error:", error.message);
      return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
    }

    const requests = (data || []).map((r: Record<string, unknown> & { cash_registers?: { name?: string } }) => ({
      ...r,
      register_name: r.cash_registers?.name || "",
      cash_registers: undefined,
    }));

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Register requests GET error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
}

// ── POST /api/register-requests ─────────────────────────────────────────────
// Raise a request. Any authenticated user of the store may ask; asking is not
// the privilege, being granted it is.
export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    const { storeId, userId } = readAuthHeader(request);

    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const registerId = typeof body?.register_id === "string" ? body.register_id : "";
    const kind = body?.kind;

    if (!registerId) {
      return NextResponse.json({ error: "register_id is required" }, { status: 400 });
    }
    if (!REQUEST_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${REQUEST_KINDS.join(", ")}` },
        { status: 400 }
      );
    }

    const { data: register } = await supabase
      .from("cash_registers")
      .select("id")
      .eq("id", registerId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (!register) {
      return NextResponse.json({ error: "Register not found" }, { status: 404 });
    }

    const { data: openShift } = await supabase
      .from("cash_shifts")
      .select("id")
      .eq("register_id", registerId)
      .eq("status", "open")
      .maybeSingle();

    const { data, error } = await supabase
      .from("register_requests")
      .insert({
        store_id: storeId,
        register_id: registerId,
        shift_id: openShift?.id || null,
        kind,
        status: "pending",
        requested_by: caller.userId,
        requested_by_name: caller.name,
        reason:
          typeof body.reason === "string" && body.reason.trim()
            ? body.reason.trim().slice(0, 500)
            : null,
        payload: body.payload && typeof body.payload === "object" ? body.payload : {},
        expires_at: new Date(Date.now() + REQUEST_TTL_MINUTES * 60_000).toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Register request create error:", error.message);
      return NextResponse.json({ error: "Failed to raise request" }, { status: 500 });
    }

    return NextResponse.json({ request: data }, { status: 201 });
  } catch (error) {
    console.error("Register requests POST error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to raise request" }, { status: 500 });
  }
}

// ── PATCH /api/register-requests ────────────────────────────────────────────
// Approve or reject. Gated on the SERVER, not merely in the deciding UI.
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
        { error: "Only the store owner or a user with Cash Register permission can decide a request" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const requestId = typeof body?.request_id === "string" ? body.request_id : "";
    const decision = body?.decision;

    if (!requestId) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    }
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    const { data: existing } = await supabase
      .from("register_requests")
      .select("id, status, expires_at")
      .eq("id", requestId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json(
        { error: `This request was already ${existing.status}` },
        { status: 409 }
      );
    }
    // A lapsed request cannot be approved late — the cashier has long since
    // moved on, and granting it would authorise something nobody is watching.
    if (new Date(existing.expires_at).getTime() < Date.now()) {
      await supabase
        .from("register_requests")
        .update({ status: "expired" })
        .eq("id", requestId)
        .eq("store_id", storeId);
      return NextResponse.json(
        { error: "This request expired before it was answered. Ask the cashier to raise it again." },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("register_requests")
      .update({
        status: decision,
        decided_by: caller.userId,
        decided_by_name: caller.name,
        decided_at: new Date().toISOString(),
        decision_note:
          typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      })
      .eq("id", requestId)
      .eq("store_id", storeId)
      .eq("status", "pending") // lose a concurrent decision rather than overwrite it
      .select()
      .single();

    if (error) {
      console.error("Register request decide error:", error.message);
      return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
    }

    return NextResponse.json({ request: data });
  } catch (error) {
    console.error("Register requests PATCH error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}

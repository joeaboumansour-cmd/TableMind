// =============================================
// GET /api/auth/permissions — re-read the signed-in caller's own session
// =============================================
//
// `AuthContext.refresh()` used to select `store_users(is_active, permissions)`
// from the BROWSER with the public Supabase client. That is one of the reads
// keeping a `service_role` key in the client bundle (step 2 of bug-0006), and
// it was not store-scoped either: it filtered on `id` alone and leaned on RLS
// that this app does not have.
//
// ## The contract, which the caller depends on
//
// `refresh()` may sign a cashier out MID-SHIFT, so the difference between "the
// answer is no" and "we could not get an answer" is the whole point of this
// route. It is expressed in the status code:
//
//   200 { active: true,  permissions }  — confirmed: still employed, here is
//                                         what they may do now
//   200 { active: false }               — confirmed: the row is gone, or
//                                         `is_active` is false. Sign them out.
//   401 / 403 / 500                     — NOT an answer. The caller keeps the
//                                         session exactly as it is.
//
// A database error is therefore a 500 and never `{ active: false }`. Folding
// the two together is what the old client code did (`if (error || !employee
// || !employee.is_active) logout()`), and it throws a cashier off the till on
// a dropped packet — on an app whose promise is that it keeps selling without
// internet.
//
// `maybeSingle`, not `single`, for the same reason: PostgREST reports "no
// rows" from `.single()` as an ERROR, which would turn a deleted employee into
// an indeterminate failure and vice versa.
//
// ## Auth
//
// This deliberately does NOT use `resolveCaller()`. That helper returns `null`
// for a missing row, an inactive employee AND a failed query alike, which
// erases exactly the distinction above. It resolves the caller itself, with
// the same store scoping (`id` AND `store_id`), and reports the three cases
// separately.
//
// `x-auth-data` is still an unsigned client header (audit P0-1). A caller can
// only ask about the identity they are already claiming, and the answer is
// their own permissions, so this adds no reachable data.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader } from "@/lib/auth/apiCaller";
import { getFullPermissions, parsePermissions } from "@/lib/auth/permissions";

export async function GET(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
    }

    const { storeId, userId } = readAuthHeader(request);
    // Not an answer about the employee — just an unusable request. 401 so the
    // caller keeps its session rather than reading this as a revocation.
    if (!storeId || !userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createServiceRoleClient();

    // ── Owner ───────────────────────────────────────────────────────────────
    // The owner's session id IS the store id, and they have no `store_users`
    // row to carry permissions on. The store row doubles as the check.
    if (userId === storeId) {
      const { data: store, error } = await supabase
        .from("stores")
        .select("id")
        .eq("id", storeId)
        .maybeSingle();

      if (error) {
        console.error("[Auth] Store refresh failed:", error.message);
        return NextResponse.json({ error: "Could not read the session" }, { status: 500 });
      }
      return NextResponse.json(
        store
          ? { active: true, is_owner: true, permissions: getFullPermissions() }
          : { active: false }
      );
    }

    // ── Employee ────────────────────────────────────────────────────────────
    // Scoped by store as well as id: an employee of another tenant is not this
    // caller, and answering for them would leak their permissions.
    const { data: employee, error } = await supabase
      .from("store_users")
      .select("is_active, permissions")
      .eq("id", userId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) {
      console.error("[Auth] Permission refresh failed:", error.message);
      return NextResponse.json({ error: "Could not read the session" }, { status: 500 });
    }

    if (!employee || !employee.is_active) {
      return NextResponse.json({ active: false });
    }

    // Parsed HERE, through the one mapping driven by `SECTIONS`, exactly as
    // `POST /api/auth/login` does — so a newly added section can never arrive
    // at the client as `undefined`.
    return NextResponse.json({
      active: true,
      is_owner: false,
      permissions: parsePermissions(employee.permissions),
    });
  } catch (error) {
    console.error(
      "[Auth] Permission refresh error:",
      error instanceof Error ? error.message : "unknown"
    );
    return NextResponse.json({ error: "Could not read the session" }, { status: 500 });
  }
}

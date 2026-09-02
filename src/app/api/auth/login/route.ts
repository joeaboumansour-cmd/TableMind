// =============================================
// POST /api/auth/login — store owner and employee sign-in
// =============================================
//
// ## Why this route exists
//
// Login used to happen ENTIRELY IN THE BROWSER. The login page selected
// `stores(id, username, password_hash, license_expires_at)` with the public
// Supabase client and compared `store.password_hash !== password` on the
// device; `AuthContext.loginEmployee` did the same against `store_users`.
//
// Two things follow from that, and both are defects:
//
//   1. **`password_hash` was sent to a browser.** It is the password —
//      comparison is plaintext (audit P0-4) — so every login shipped the
//      store's credential over the wire, into the response cache, and into
//      devtools. `GET /api/cash-shifts` already carries the rule this route
//      now obeys: "password_hash is NOT selected. It must never leave the
//      database."
//
//   2. **It forced a key that bypasses RLS into the client bundle.** A real
//      anon key with RLS on returns nothing for those selects, so login fails
//      — which is why `NEXT_PUBLIC_SUPABASE_ANON_KEY` currently holds a
//      `service_role` JWT that every visitor can read (bug-0006).
//
// Moving the lookup and the comparison here removes the browser's need to read
// `stores` or `store_users` at all. It is step 1: the public key CANNOT be
// swapped until the remaining client-side Supabase reads (products, favourites)
// move too.
//
// ## What deliberately did NOT change
//
// The comparison is still plaintext against `password_hash`. That is audit
// P0-4 and a separate decision — introducing bcrypt here would invalidate
// every stored credential in production. The semantics are identical; only the
// place they run moved.
//
// ## Auth
//
// This is the route that ESTABLISHES a session, so it is unauthenticated by
// construction — there is no caller to resolve. Everything it trusts it looks
// up itself with the service-role client; nothing is taken from the body but
// the three strings the person typed.
//
// Neither the submitted password nor the stored `password_hash` may ever reach
// a log or a response. That was exactly audit P0-4 in `/api/admin/login`.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getFullPermissions,
  parsePermissions,
  type StoreUser,
} from "@/lib/auth/permissions";

/**
 * One message for "no such store", "no such employee" and "wrong password".
 * Distinguishing them tells an attacker which half they got right.
 */
const INVALID = "Invalid username or password";

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** A required, non-empty string field. Returns null when it is neither. */
function readName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

/** The public half of a store row. `password_hash` is not in it, by design. */
interface PublicStore {
  id: string;
  username: string;
  license_expires_at: string;
}

export async function POST(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return bad("Supabase is not configured", 500);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return bad("Invalid request body", 400);
    }
    const fields = (body ?? {}) as Record<string, unknown>;

    const storeUsername = readName(fields.storeUsername);
    const username = readName(fields.username);
    // The password is NOT trimmed and NOT length-clamped on the way in.
    // Trimming would silently compare a different secret than the one stored,
    // and locking out a long password is worse than accepting one.
    const password = typeof fields.password === "string" ? fields.password : null;

    if (!storeUsername || !username || !password) {
      return bad("Store username, username and password are required", 400);
    }

    const supabase = await createServiceRoleClient();

    // `maybeSingle`, not `single`: PostgREST reports "no rows" from `.single()`
    // as an error, which would fold "no such store" into "the query failed".
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, username, password_hash, license_expires_at")
      .eq("username", storeUsername)
      .maybeSingle();

    if (storeError) {
      console.error("[Login] Store lookup failed:", storeError.message);
      return bad("An error occurred during login", 500);
    }
    if (!store) return bad(INVALID, 401);

    // Checked before the password, exactly where the browser checked it. A
    // store whose licence lapsed cannot sign in on either path.
    if (new Date(store.license_expires_at) < new Date()) {
      return bad("Your license has expired. Please contact support to renew.", 403);
    }

    const publicStore: PublicStore = {
      id: store.id,
      username: store.username,
      license_expires_at: store.license_expires_at,
    };

    // ── Owner: the person's username IS the store's username ────────────────
    if (username === store.username) {
      if (store.password_hash !== password) return bad(INVALID, 401);

      const user: StoreUser = {
        id: store.id,
        storeId: store.id,
        username: store.username,
        displayName: store.username,
        isOwner: true,
        permissions: getFullPermissions(),
      };
      return NextResponse.json({ store: publicStore, user });
    }

    // ── Employee ────────────────────────────────────────────────────────────
    // Scoped to the store we just resolved, never to a store_id from the body.
    const { data: employee, error: employeeError } = await supabase
      .from("store_users")
      .select("id, store_id, username, password_hash, display_name, is_active, permissions")
      .eq("store_id", store.id)
      .eq("username", username)
      .maybeSingle();

    if (employeeError) {
      console.error("[Login] Employee lookup failed:", employeeError.message);
      return bad("An error occurred during login", 500);
    }
    if (!employee) return bad(INVALID, 401);

    // Checked before the password, as the browser did.
    if (!employee.is_active) {
      return bad("This account has been deactivated. Contact your store owner.", 403);
    }
    if (employee.password_hash !== password) return bad(INVALID, 401);

    // Permissions are parsed HERE so the client never has to decide what a
    // stored blob means — one reading of `SECTIONS`, server-side.
    const user: StoreUser = {
      id: employee.id,
      storeId: employee.store_id,
      username: employee.username,
      displayName: employee.display_name || employee.username,
      isOwner: false,
      permissions: parsePermissions(employee.permissions),
    };
    return NextResponse.json({ store: publicStore, user });
  } catch (error) {
    // The message only — never the body, which holds the password.
    console.error("[Login] Unexpected failure:", error instanceof Error ? error.message : "unknown");
    return bad("An error occurred during login", 500);
  }
}

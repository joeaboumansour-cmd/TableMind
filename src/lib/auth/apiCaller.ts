// =============================================
// Server-side caller resolution for cash routes
// =============================================
// One place that answers "who is calling and what may they do", instead of the
// copy of that logic that previously sat at the top of every cash route.
//
// ## What this fixes: audit P0-3
//
// The old helpers did this:
//
//     if (!userId) return { isOwner: true, ... };   // ❌
//
// Absence was treated as proof of ownership. Since the caller writes the header
// themselves, ANY employee could delete `user_id` from it and be promoted to
// store owner — which on these routes means unrestricted cash in/out of the
// drawer. The comment at the top of the old cash-shifts route claimed the
// opposite ("We verify server-side, not from client claims"); the code did not.
//
// Now the owner is identified POSITIVELY: an owner's session id IS the store id
// (see AuthContext.loadUserFromStorage, which builds the owner StoreUser with
// `id: parsed.store_id`). An employee is looked up in `store_users` and gets the
// permissions the database says they have. A missing `user_id` is a 401.
//
// ## What this does NOT fix: audit P0-1
//
// `x-auth-data` is still an unsigned client-supplied header, so a caller who
// knows the store's UUID can still forge `user_id === store_id` and claim to be
// the owner. Closing that requires the signed-token work in `lib/auth/jwt.ts`
// and a change to every route and client call — deliberately out of scope here.
//
// The improvement is real but partial: escalation now requires knowing and
// forging a specific UUID rather than simply omitting a field. Do not describe
// these routes as authenticated until P0-1 lands.
// =============================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Caller {
  isOwner: boolean;
  /** null for the owner — `cash_shifts.opened_by` FKs to store_users. */
  userId: string | null;
  name: string;
  hasCashRegisterPerm: boolean;
  /**
   * The caller's section permissions, as stored on `store_users.permissions`.
   * Empty for the owner, who is allowed everything by `isOwner` instead.
   */
  permissions: Record<string, boolean>;
}

export interface AuthHeader {
  storeId: string;
  userId: string | null;
}

/** Parse `x-auth-data`. Returns empty values rather than throwing. */
export function readAuthHeader(request: Request): AuthHeader {
  const raw = request.headers.get("x-auth-data");
  if (!raw) return { storeId: "", userId: null };
  try {
    const parsed = JSON.parse(raw);
    return {
      storeId: typeof parsed?.store_id === "string" ? parsed.store_id : "",
      userId: typeof parsed?.user_id === "string" && parsed.user_id ? parsed.user_id : null,
    };
  } catch {
    return { storeId: "", userId: null };
  }
}

/**
 * Resolve the caller, or null when they cannot be established.
 *
 * Null must always become a 401 — never a fallback identity.
 */
export async function resolveCaller(
  supabase: SupabaseClient,
  storeId: string,
  userId: string | null
): Promise<Caller | null> {
  if (!storeId) return null;

  // A missing user_id used to mean "owner". It now means "unidentified".
  if (!userId) return null;

  // ── Owner ────────────────────────────────────────────────────────────────
  // The owner's session id IS the store id. One query, and it doubles as the
  // "does this store exist" check.
  if (userId === storeId) {
    const { data: store } = await supabase
      .from("stores")
      .select("id, username")
      .eq("id", storeId)
      .maybeSingle();

    if (!store) return null;

    return {
      isOwner: true,
      userId: null,
      name: store.username,
      hasCashRegisterPerm: true,
      permissions: {},
    };
  }

  // ── Employee ─────────────────────────────────────────────────────────────
  // Also ONE query. The separate `stores` existence check that used to run
  // first was redundant: store_users.store_id is a foreign key, so a row
  // matching this store_id proves the store exists. Dropping it halves the
  // auth cost of every request, and this runs on every call to every cash
  // route — three of which the cash page fires at once.
  const { data: emp } = await supabase
    .from("store_users")
    .select("id, display_name, username, is_active, permissions")
    .eq("id", userId)
    .eq("store_id", storeId) // tenancy scoping: an employee of another store is not a caller here
    .maybeSingle();

  if (!emp || !emp.is_active) return null;

  let perms: Record<string, boolean> = {};
  try {
    perms = typeof emp.permissions === "string" ? JSON.parse(emp.permissions) : emp.permissions || {};
  } catch {
    perms = {};
  }

  return {
    isOwner: false,
    userId: emp.id,
    name: emp.display_name || emp.username,
    hasCashRegisterPerm: perms.cash_register === true,
    permissions: perms,
  };
}

/** May this caller open/close shifts and manage registers? */
export function canManageRegister(caller: Caller): boolean {
  return caller.isOwner || caller.hasCashRegisterPerm;
}

/**
 * May this caller read/act on a whole section (`pos`, `inventory`,
 * `transactions`, `receipts`, `cash_register`)?
 *
 * Hiding a nav link is not a guard. `/transactions` shipped with no check at
 * all on either side: a cashier with transactions:false who typed the URL got
 * the full History page, and `GET /api/transactions` plus
 * `/api/transactions/analytics` served them every sale and the store's PROFIT.
 * Found by signing in as a real POS-only employee — the owner account holds all
 * five sections, so nothing else exercised a denial.
 *
 * The owner is allowed everything; they have no `store_users` row to carry
 * permissions on.
 */
export function canAccessSection(caller: Caller, section: string): boolean {
  return caller.isOwner || caller.permissions[section] === true;
}

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

  const { data: store } = await supabase
    .from("stores")
    .select("id, username")
    .eq("id", storeId)
    .maybeSingle();

  if (!store) return null;

  // A missing user_id used to mean "owner". It now means "unidentified".
  if (!userId) return null;

  // The owner's session id is the store id. This is a positive check against a
  // value the server just loaded, not an inference from an absent field.
  if (userId === storeId) {
    return {
      isOwner: true,
      userId: null,
      name: store.username,
      hasCashRegisterPerm: true,
    };
  }

  const { data: emp } = await supabase
    .from("store_users")
    .select("id, store_id, display_name, username, is_active, permissions")
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
  };
}

/** May this caller open/close shifts and manage registers? */
export function canManageRegister(caller: Caller): boolean {
  return caller.isOwner || caller.hasCashRegisterPerm;
}

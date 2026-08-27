/**
 * The `x-auth-data` header every API route in this app reads.
 *
 * It was being rebuilt by hand at each call site, with the `user_id` rule
 * ("employees carry one, owners do not") re-derived slightly differently in
 * each. That rule decides which permissions the server looks up, so it needs
 * to exist once.
 *
 * ⚠️ This header is UNSIGNED — it is the known P0-1 vulnerability, not a
 * security boundary. It is centralised here so that when `src/lib/auth/jwt.ts`
 * replaces it there is one place to change rather than a dozen.
 */

export interface CallerIdentity {
  store_id: string;
  /** Employees only. An owner's id is the store id, so it is omitted. */
  user_id?: string;
  /** For attribution on the row being written. */
  user_name?: string;
  isOwner: boolean;
}

/** Read who is signed in, from the same localStorage keys AuthContext writes. */
export function readCallerIdentity(): CallerIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const auth = JSON.parse(localStorage.getItem("goldensquirrel_auth") || "{}");
    const storeId = auth?.store_id;
    if (!storeId) return null;

    const identity: CallerIdentity = { store_id: storeId, isOwner: true };

    const raw = localStorage.getItem("goldensquirrel_user");
    if (raw) {
      const user = JSON.parse(raw);
      identity.isOwner = user?.isOwner !== false;
      if (user?.displayName || user?.username) {
        identity.user_name = user.displayName || user.username;
      }
      // Only an employee carries a user_id: an owner's id IS the store id, and
      // sending it would make the server look them up in store_users and find
      // nothing.
      if (user?.isOwner === false && user?.id) identity.user_id = user.id;
    }

    return identity;
  } catch {
    return null;
  }
}

/** JSON headers plus `x-auth-data` for the signed-in caller. */
export function buildAuthHeaders(identity?: CallerIdentity | null): Record<string, string> {
  const caller = identity === undefined ? readCallerIdentity() : identity;
  const payload: Record<string, string> = {};
  if (caller) {
    payload.store_id = caller.store_id;
    if (caller.user_id) payload.user_id = caller.user_id;
  }
  return {
    "Content-Type": "application/json",
    "x-auth-data": JSON.stringify(payload),
  };
}

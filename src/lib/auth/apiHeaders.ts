// =============================================
// The `x-auth-data` header, built in one place
// =============================================
// This existed as six near-identical private copies across the app (audit P3:
// `hasAuthInStorage` / `buildAuthHeaders` / `getStoreIdFromStorage`). New and
// touched code uses this one.
//
// ## The owner now sends an explicit id
//
// The old builders sent `user_id` only for employees, so an owner's header was
// `{store_id}` with no user. The server then read "no user_id" as "this is the
// owner" — which is audit P0-3, because an employee could produce that same
// header by deleting a field.
//
// The owner's session id IS the store id (AuthContext builds the owner
// StoreUser that way), so sending it costs nothing and lets the server identify
// the owner positively. See `lib/auth/apiCaller.ts`.
//
// Routes that have been moved onto `resolveCaller()` reject a header with no
// `user_id`. Always build headers through this function when calling them.
// =============================================

interface UserLike {
  id?: string;
  storeId?: string;
  isOwner?: boolean;
}

/** Read the store id from either session key, preferring the passed-in user. */
export function getStoreId(user?: UserLike | null): string {
  if (user?.storeId) return user.storeId;
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("goldensquirrel_auth");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return typeof parsed?.store_id === "string" ? parsed.store_id : "";
  } catch {
    return "";
  }
}

/**
 * Build the JSON auth headers for an API call.
 *
 * Pass the `useAuth()` user where one is available; falls back to localStorage
 * for the call sites that do not have it yet.
 */
export function buildAuthHeaders(user?: UserLike | null): Record<string, string> {
  let resolved: UserLike | null | undefined = user;

  if (!resolved && typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem("goldensquirrel_user");
      if (raw) resolved = JSON.parse(raw) as UserLike;
    } catch {
      resolved = null;
    }
  }

  const storeId = getStoreId(resolved);

  // The owner's id is the store id; an employee's is their store_users row.
  // Either way the field is always present, so the server never has to guess.
  const userId = resolved?.isOwner ? storeId : resolved?.id || "";

  const payload: Record<string, string> = { store_id: storeId };
  if (userId) payload.user_id = userId;

  return {
    "Content-Type": "application/json",
    "x-auth-data": JSON.stringify(payload),
  };
}

"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { StoreUser, canAccess, getFullPermissions, parsePermissions, SectionKey, UserPermissions } from "./permissions";
import { cacheCredentials, clearCachedCredentials, validateCachedCredentials } from "./offlineAuth";
import { purgeCredentialCache } from "@/lib/pwa/purgeCredentialCache";
import { logActivity, invalidateActivityIdentity, flushActivity } from "@/lib/activity/logger";
import { connectivity } from "@/lib/connectivity";
import { clearResourceCache } from "@/lib/data/resource";

const supabase = createClient();

interface AuthContextValue {
  user: StoreUser | null;
  isLoading: boolean;
  /**
   * Online sign-in for BOTH an owner and an employee.
   *
   * This used to be two functions — `login(storeUsername, password)` for the
   * owner and `loginEmployee(storeId, …)` for staff — with the login PAGE
   * deciding which to call, because the page had read the `stores` row itself
   * and could compare usernames. It no longer reads that row (it no longer
   * can, without a key that bypasses RLS), so the decision moved to
   * `POST /api/auth/login`, which is the only thing that knows the answer.
   */
  login: (storeUsername: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginOffline: (storeUsername: string, password: string, username?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  canAccess: (section: SectionKey) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Load user from localStorage (runs synchronously for initial render).
 * Checks goldensquirrel_user first, then goldensquirrel_auth for backward compatibility.
 */
function loadUserFromStorage(): StoreUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("goldensquirrel_user");
    if (raw) {
      return JSON.parse(raw) as StoreUser;
    }
    
    // Backward compatibility - check legacy goldensquirrel_auth
    const legacyAuth = localStorage.getItem("goldensquirrel_auth");
    if (legacyAuth) {
      try {
        const parsed = JSON.parse(legacyAuth);
        // Create owner user from legacy data
        const ownerUser: StoreUser = {
          id: parsed.store_id,
          storeId: parsed.store_id,
          username: parsed.username,
          displayName: parsed.username,
          isOwner: true,
          permissions: getFullPermissions(),
        };
        return ownerUser;
      } catch {
        // ignore
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

function saveUserToStorage(user: StoreUser) {
  localStorage.setItem("goldensquirrel_user", JSON.stringify(user));
}

/**
 * Write the legacy `goldensquirrel_auth` key.
 *
 * This is NOT cosmetic. It is the tenancy header for every API call:
 * `sync/engine.ts` sends `localStorage.getItem("goldensquirrel_auth")` as
 * `x-auth-data`, and many components still read `store_id` out of it directly
 * rather than going through useAuth().
 *
 * Every login path writes it from in here now — the ONLINE paths used to write
 * it from inside the login page, which is where the OFFLINE
 * path's omission came from: an offline login produced a session where
 * `goldensquirrel_user` was set but this key was absent, the sync engine sent
 * `x-auth-data: {}`, and the API answered
 * `401 Unauthorized - No store_id in auth data` for every queued sale.
 *
 * That is the exact multi-day-outage scenario: a cashier logs in offline,
 * sells all day, and none of it can ever sync. Confirmed on production
 * 2026-08-24. Writing it here rather than in the page means no future caller
 * of loginOffline can forget it.
 */
function saveLegacyAuthToStorage(storeId: string, username: string, licenseExpiresAt?: string) {
  localStorage.setItem(
    "goldensquirrel_auth",
    JSON.stringify({
      store_id: storeId,
      username,
      license_expires_at: licenseExpiresAt ?? null,
      timestamp: Date.now(),
    })
  );
}

/**
 * Per-store display caches that must not survive a logout.
 *
 * The cash snapshot holds one store's drawer figures for instant rendering,
 * and the category list holds one store's rail. Clear both on logout so the
 * next person to sign in on this device — plausibly a different store,
 * certainly a different shift — cannot be shown the last one's data before the
 * first fetch returns.
 */
const CLEAR_ON_LOGOUT_PREFIXES = [
  "goldensquirrel_cash_snapshot_",
  "store_categories_",
];

function clearUserFromStorage() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (CLEAR_ON_LOGOUT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* a storage we cannot read is a storage with nothing to leak */
  }

  // The same data held in memory by the data layer. The persisted copies are
  // gone above, but a component that never remounts would keep painting the
  // last person's from the in-memory entry.
  clearResourceCache();

  localStorage.removeItem("goldensquirrel_user");
  localStorage.removeItem("goldensquirrel_auth"); // legacy cleanup
  // NOTE: Do NOT clear cached credentials here.
  // They persist across logout/login cycles so the user
  // can still log in offline after logging out.
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<StoreUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasInitialized = useRef(false);

  // On mount, load user from storage
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      const storedUser = loadUserFromStorage();
      setUser(storedUser);
      setIsLoading(false);
    }
  }, []);

  /**
   * Online sign-in, for an owner and an employee alike.
   *
   * ## Nothing here reads `stores` or `store_users` any more
   *
   * It used to: this function selected the whole store row — `password_hash`
   * included — into the browser and compared the password on the device, and
   * `loginEmployee` did the same against `store_users`. Two defects in one
   * (bug-0006): the store's password was shipped to every till, and the reads
   * only worked because the client held a key that bypasses RLS.
   *
   * `POST /api/auth/login` does the lookup and the comparison server-side and
   * returns only what a session needs. The comparison itself is unchanged and
   * still plaintext — that is audit P0-4, and a separate decision.
   */
  const login = useCallback(async (storeUsername: string, username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      let response: Response;
      try {
        response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeUsername, username, password }),
        });
      } catch {
        // The caller only reaches this function when the heartbeat says we are
        // online, so a transport failure is worth naming rather than reporting
        // as bad credentials.
        return { success: false, error: "Could not reach the server. Please check your connection and try again." };
      }

      const payload = await response.json().catch(() => null) as
        | { store: { id: string; username: string; license_expires_at: string }; user: StoreUser }
        | { error?: string }
        | null;

      if (!response.ok || !payload || !("user" in payload)) {
        const message = (payload as { error?: string } | null)?.error;
        return { success: false, error: message || "Invalid username or password" };
      }

      const { store, user: authUser } = payload;

      setUser(authUser);
      saveUserToStorage(authUser);
      // Without this the session cannot sync — see saveLegacyAuthToStorage.
      // The login page used to write it for the two online paths; doing it here
      // means no caller can forget it, exactly as for loginOffline.
      saveLegacyAuthToStorage(authUser.storeId, authUser.username, store.license_expires_at);

      // Attribution is still passed explicitly rather than looked up, so the
      // event does not depend on the write above having landed first.
      invalidateActivityIdentity();
      logActivity("auth.login", authUser.isOwner
        ? {
            target: authUser.username,
            identity: { store_id: authUser.storeId, user_name: authUser.username },
            details: { role: "owner", mode: "online" },
          }
        : {
            target: authUser.displayName,
            identity: {
              store_id: authUser.storeId,
              user_id: authUser.id,
              user_name: authUser.displayName,
            },
            details: { role: "employee", mode: "online", permissions: authUser.permissions },
          });

      // Cache credentials for offline login fallback.
      //
      // The first argument MUST be the STORE's username, not the employee's —
      // the login form asks for the store username, so an entry keyed by the
      // employee could never be matched (audit P1-10). It is taken from the
      // server's answer rather than the typed field so the two paths cannot
      // disagree about the canonical spelling.
      //
      // No `password_hash` is passed any more. Nothing ever read it back, and
      // the column no longer leaves the database.
      cacheCredentials(
        store.username,
        authUser.username,
        password,
        {
          id: store.id,
          username: store.username,
          license_expires_at: store.license_expires_at,
        },
        authUser.isOwner
          ? null
          : {
              id: authUser.id,
              store_id: authUser.storeId,
              username: authUser.username,
              display_name: authUser.displayName,
              // Reaching here means the server confirmed both.
              is_active: true,
              permissions: authUser.permissions,
            }
      );

      return { success: true };
    } catch (err) {
      console.error("Login error:", err);
      return { success: false, error: "An error occurred during login" };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Offline login fallback — validates credentials against cached data.
   * Used when the user is offline and cannot reach Supabase.
   */
  const loginOffline = useCallback(async (storeUsername: string, password: string, username?: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      // `username` distinguishes colleagues who share a store. Passing it means
      // an employee gets THEIR entry rather than whichever one happens to match
      // the password first.
      const cached = validateCachedCredentials(storeUsername, password, username);
      if (!cached) {
        return { success: false, error: "No cached credentials found for this user. Please connect to the internet to log in." };
      }

      const { storeData, employeeData } = cached;

      // If employee data exists, this was an employee login
      if (employeeData) {
        const perms: UserPermissions = parsePermissions(employeeData.permissions);

        const employeeUser: StoreUser = {
          id: employeeData.id,
          storeId: employeeData.store_id,
          username: employeeData.username,
          displayName: employeeData.display_name || employeeData.username,
          isOwner: false,
          permissions: perms,
        };

        setUser(employeeUser);
        saveUserToStorage(employeeUser);
        // Without this the session cannot sync — see saveLegacyAuthToStorage.
        saveLegacyAuthToStorage(
          employeeData.store_id,
          employeeData.username,
          storeData.license_expires_at
        );
        invalidateActivityIdentity();
        logActivity("auth.login", {
          target: employeeUser.displayName,
          details: { role: "employee", mode: "offline" },
        });
        return { success: true };
      }

      // Owner login from cached data
      const ownerUser: StoreUser = {
        id: storeData.id,
        storeId: storeData.id,
        username: storeData.username,
        displayName: storeData.username,
        isOwner: true,
        permissions: getFullPermissions(),
      };

      setUser(ownerUser);
      saveUserToStorage(ownerUser);
      // Without this the session cannot sync — see saveLegacyAuthToStorage.
      saveLegacyAuthToStorage(
        storeData.id,
        storeData.username,
        storeData.license_expires_at
      );
      invalidateActivityIdentity();
      logActivity("auth.login", {
        target: storeData.username,
        details: { role: "owner", mode: "offline" },
      });
      return { success: true };
    } catch (err) {
      console.error("Offline login error:", err);
      return { success: false, error: "An error occurred during offline login" };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Logged and flushed BEFORE the auth keys are removed. clearUserFromStorage
    // drops goldensquirrel_auth, and an event recorded after that has no
    // store_id to be attributed to — it would simply be discarded.
    logActivity("auth.logout", {
      target: user?.displayName,
      details: { role: user?.isOwner ? "owner" : "employee" },
    });
    flushActivity();

    setUser(null);
    clearUserFromStorage();
    invalidateActivityIdentity();

    // Signing out must also drop any credential response the service worker
    // cached, or "log out" on a shared till leaves the owner's password
    // readable on disk to whoever sits down next. Not awaited: logout is a
    // button press and must not wait on cache housekeeping. The launch-time
    // purge in providers.tsx covers a device that never signs out.
    //
    // This does NOT touch goldensquirrel_offline_credentials_v2 — see
    // clearCachedCredentials() in offlineAuth.ts, which is deliberately not
    // called here so a cashier signing off during an outage can sign back in.
    void purgeCredentialCache();
  }, [user]);

  /**
   * Re-read this employee's permissions from the server.
   *
   * ## Signing someone out requires PROOF, not silence
   *
   * This used to be `if (error || !employee || !employee.is_active) logout()`,
   * which folded three different situations into one:
   *
   *   1. the query FAILED  — we learned nothing
   *   2. the row is GONE   — the employee was deleted
   *   3. is_active = false — the employee was switched off
   *
   * Only (2) and (3) are answers. (1) is the absence of one, and logging out on
   * it means a dropped packet, an RLS change, a slow network or simply being
   * offline throws a cashier off the till in the middle of a shift — on an app
   * whose whole promise is that it keeps selling without internet.
   *
   * The `.single()` made this worse and is why the fix is not just "drop the
   * error check": PostgREST returns zero rows from `.single()` as an ERROR, so
   * case (2) arrives looking exactly like case (1). `.maybeSingle()` separates
   * them — a missing row comes back as `data: null, error: null`, which is a
   * real answer we can act on. It is also what resolveCaller() already uses
   * server-side.
   *
   * Same rule as evaluateReconcile() and the feature-flag guard: never act
   * destructively on unknown.
   */
  const refresh = useCallback(async () => {
    if (!user) return;
    if (!user.isOwner) {
      // Nothing to learn while offline, and asking anyway only invites the
      // failure this function must not overreact to.
      if (!connectivity.isOnline) return;

      try {
        const { data: employee, error } = await supabase
          .from("store_users")
          .select("is_active, permissions")
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          // Could not ask. Keep the session exactly as it is and try again
          // next time — the server still enforces permissions on every call.
          console.warn(
            "[Auth] Permission refresh failed; keeping current session:",
            error.message
          );
          return;
        }

        // Now these ARE answers: the row is gone, or it is switched off.
        if (!employee || !employee.is_active) {
          logout();
          return;
        }

        const rawPerms = typeof employee.permissions === "string"
          ? JSON.parse(employee.permissions)
          : employee.permissions;

        const updatedUser: StoreUser = {
          ...user,
          permissions: parsePermissions(rawPerms),
        };
        setUser(updatedUser);
        saveUserToStorage(updatedUser);
      } catch {
        // Ignore refresh errors
      }
    }
  }, [user, logout]);

  const checkAccess = useCallback((section: SectionKey): boolean => {
    return canAccess(user, section);
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      login,
      loginOffline,
      logout,
      canAccess: checkAccess,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

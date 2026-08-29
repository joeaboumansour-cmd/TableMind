"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { StoreUser, canAccess, getFullPermissions, SectionKey, UserPermissions } from "./permissions";
import { cacheCredentials, clearCachedCredentials, validateCachedCredentials } from "./offlineAuth";
import { logActivity, invalidateActivityIdentity, flushActivity } from "@/lib/activity/logger";
import { connectivity } from "@/lib/connectivity";

const supabase = createClient();

interface AuthContextValue {
  user: StoreUser | null;
  isLoading: boolean;
  login: (storeUsername: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginEmployee: (storeId: string, storeUsername: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
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
 * Both ONLINE login paths write it from inside the login page. The OFFLINE
 * path did not — so an offline login produced a session where
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

  const login = useCallback(async (storeUsername: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      // Fetch store by username
      const { data: store, error } = await supabase
        .from("stores")
        .select("*")
        .eq("username", storeUsername)
        .single();

      if (error || !store) {
        return { success: false, error: "Invalid username or password" };
      }

      // Check license expiration
      const licenseExpires = new Date(store.license_expires_at);
      const now = new Date();
      if (licenseExpires < now) {
        return { success: false, error: "Your license has expired. Please contact support to renew." };
      }

      // Verify password
      if (store.password_hash !== password) {
        return { success: false, error: "Invalid username or password" };
      }

      // Store owner = full permissions
      const ownerUser: StoreUser = {
        id: store.id,
        storeId: store.id,
        username: store.username,
        displayName: store.username,
        isOwner: true,
        permissions: getFullPermissions(),
      };

      setUser(ownerUser);
      saveUserToStorage(ownerUser);

      // Attribution is passed explicitly: the login page writes
      // goldensquirrel_auth only AFTER this resolves, so reading storage here
      // would find no tenant and the event would be dropped.
      invalidateActivityIdentity();
      logActivity("auth.login", {
        target: store.username,
        identity: { store_id: store.id, user_name: store.username },
        details: { role: "owner", mode: "online" },
      });

      // Cache credentials for offline login fallback.
      // Owner login: the person's username IS the store username.
      cacheCredentials(storeUsername, store.username, password, {
        id: store.id,
        username: store.username,
        password_hash: store.password_hash,
        license_expires_at: store.license_expires_at,
      });

      return { success: true };
    } catch (err) {
      console.error("Login error:", err);
      return { success: false, error: "An error occurred during login" };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginEmployee = useCallback(async (storeId: string, storeUsername: string, username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const { data: employee, error } = await supabase
        .from("store_users")
        .select("*")
        .eq("store_id", storeId)
        .eq("username", username)
        .single();

      if (error || !employee) {
        return { success: false, error: "Invalid username or password" };
      }

      if (!employee.is_active) {
        return { success: false, error: "This account has been deactivated. Contact your store owner." };
      }

      // Verify password
      if (employee.password_hash !== password) {
        return { success: false, error: "Invalid username or password" };
      }

      // Parse permissions
      let perms: UserPermissions;
      try {
        const rawPerms = typeof employee.permissions === "string"
          ? JSON.parse(employee.permissions)
          : employee.permissions;
        perms = {
          pos: rawPerms.pos === true,
          inventory: rawPerms.inventory === true,
          transactions: rawPerms.transactions === true,
          receipts: rawPerms.receipts === true,
          cash_register: rawPerms.cash_register === true,
        };
      } catch {
        perms = {
          pos: false,
          inventory: false,
          transactions: false,
          receipts: false,
          cash_register: false,
        };
      }

      const employeeUser: StoreUser = {
        id: employee.id,
        storeId: employee.store_id,
        username: employee.username,
        displayName: employee.display_name || employee.username,
        isOwner: false,
        permissions: perms,
      };

      setUser(employeeUser);
      saveUserToStorage(employeeUser);

      invalidateActivityIdentity();
      logActivity("auth.login", {
        target: employeeUser.displayName,
        identity: {
          store_id: employeeUser.storeId,
          user_id: employeeUser.id,
          user_name: employeeUser.displayName,
        },
        details: { role: "employee", mode: "online", permissions: perms },
      });

      // Cache credentials for offline login fallback.
      //
      // The first argument MUST be the STORE's username, not the employee's.
      // It used to pass `username` (the employee), so the entry could never be
      // matched by the login form — which asks for the store username — and
      // employee offline login simply did not work. (audit P1-10)
      cacheCredentials(storeUsername, username, password, {
        id: employee.store_id,
        username: storeUsername,
        password_hash: employee.password_hash,
        license_expires_at: "", // Will be filled from store data if available
      }, {
        id: employee.id,
        store_id: employee.store_id,
        username: employee.username,
        password_hash: employee.password_hash,
        display_name: employee.display_name,
        is_active: employee.is_active,
        permissions: employee.permissions,
      });

      return { success: true };
    } catch (err) {
      console.error("Employee login error:", err);
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
        // Parse permissions
        let perms: UserPermissions;
        try {
          const rawPerms = typeof employeeData.permissions === "string"
            ? JSON.parse(employeeData.permissions)
            : employeeData.permissions;
          perms = {
            pos: rawPerms.pos === true,
            inventory: rawPerms.inventory === true,
            transactions: rawPerms.transactions === true,
            receipts: rawPerms.receipts === true,
            cash_register: rawPerms.cash_register === true,
          };
        } catch {
          perms = {
            pos: false,
            inventory: false,
            transactions: false,
            receipts: false,
            cash_register: false,
          };
        }

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
          permissions: {
            pos: rawPerms.pos === true,
            inventory: rawPerms.inventory === true,
            transactions: rawPerms.transactions === true,
            receipts: rawPerms.receipts === true,
            cash_register: rawPerms.cash_register === true,
          },
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
      loginEmployee,
      loginOffline,
      logout,
      canAccess: checkAccess,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

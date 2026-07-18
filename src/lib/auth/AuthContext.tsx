"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { StoreUser, canAccess, getFullPermissions, SectionKey, UserPermissions } from "./permissions";

const supabase = createClient();

interface AuthContextValue {
  user: StoreUser | null;
  isLoading: boolean;
  login: (storeUsername: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginEmployee: (storeId: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
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

function clearUserFromStorage() {
  localStorage.removeItem("goldensquirrel_user");
  localStorage.removeItem("goldensquirrel_auth"); // legacy cleanup
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
      return { success: true };
    } catch (err) {
      console.error("Login error:", err);
      return { success: false, error: "An error occurred during login" };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginEmployee = useCallback(async (storeId: string, username: string, password: string): Promise<{ success: boolean; error?: string }> => {
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
        };
      } catch {
        perms = {
          pos: false,
          inventory: false,
          transactions: false,
          receipts: false,
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
      return { success: true };
    } catch (err) {
      console.error("Employee login error:", err);
      return { success: false, error: "An error occurred during login" };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearUserFromStorage();
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    if (!user.isOwner) {
      // Re-fetch employee permissions in case they changed
      try {
        const { data: employee, error } = await supabase
          .from("store_users")
          .select("is_active, permissions")
          .eq("id", user.id)
          .single();

        if (error || !employee || !employee.is_active) {
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
      logout,
      canAccess: checkAccess,
      refresh,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
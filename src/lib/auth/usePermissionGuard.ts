"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { canAccess, SectionKey, type StoreUser } from "./permissions";

/**
 * Gets the current user from localStorage (synchronous).
 * Must be called from a "use client" component.
 */
export function getCurrentUser(): StoreUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("goldensquirrel_user");
    if (!raw) return null;
    return JSON.parse(raw) as StoreUser;
  } catch {
    return null;
  }
}

/**
 * Returns the store_id from the current authenticated user.
 * Works for both owners and employees.
 */
export function getStoreId(): string | null {
  const user = getCurrentUser();
  return user?.storeId || null;
}

/**
 * Returns the display name of the current user.
 */
export function getUserDisplayName(): string {
  const user = getCurrentUser();
  return user?.displayName || user?.username || "";
}

/**
 * Checks if user has permission. Redirects to /login if not.
 * Uses a mounted ref to prevent redirect loops on initial load.
 * Use at the top of any page component.
 */
export function usePermissionGuard(section: SectionKey): StoreUser | null {
  const router = useRouter();
  const hasRedirected = useRef(false);
  const user = getCurrentUser();

  useEffect(() => {
    // Skip if we've already redirected (prevents loops)
    if (hasRedirected.current) return;

    if (!user) {
      hasRedirected.current = true;
      router.replace("/login");
      return;
    }
    if (!canAccess(user, section)) {
      hasRedirected.current = true;
      router.replace("/login");
      return;
    }
  }, [user, section, router]);

  return user;
}

/**
 * Static permission check without redirect.
 * Returns true/false.
 */
export function hasSectionAccess(section: SectionKey): boolean {
  const user = getCurrentUser();
  return canAccess(user, section);
}
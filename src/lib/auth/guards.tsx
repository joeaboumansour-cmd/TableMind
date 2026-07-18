"use client";

import React from "react";
import { useAuth } from "./AuthContext";
import { SectionKey, SECTIONS } from "./permissions";

interface PermissionGuardProps {
  children: React.ReactNode;
  section: SectionKey;
  fallback?: React.ReactNode;
}

/**
 * Wraps content that requires a specific section permission.
 * If user doesn't have access, shows fallback or "no access" message.
 */
export function PermissionGuard({ children, section, fallback }: PermissionGuardProps) {
  const { user, canAccess } = useAuth();

  if (!user) return null;

  if (!canAccess(section)) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <div className="h-screen flex items-center justify-center bg-background p-8">
        <div className="text-center max-w-md">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Access Restricted</h2>
          <p className="text-muted-foreground">
            You don't have permission to access {SECTIONS[section]?.label?.toLowerCase() || "this section"}.
            Contact your store owner to update your permissions.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Redirect guard — wraps a page and redirects if no access.
 * Use this in layout pages.
 */
export function withPermissionGuard<P extends object>(
  Component: React.ComponentType<P>,
  section: SectionKey
) {
  return function PermissionGuardedPage(props: P) {
    return (
      <PermissionGuard section={section}>
        <Component {...props} />
      </PermissionGuard>
    );
  };
}
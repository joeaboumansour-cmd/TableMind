// =============================================
// Role-Based Access Control Components
// =============================================

import React from "react";
import { useRouter } from "next/navigation";

// Simple user type for POS system
interface User {
  id: string;
  store_id: string;
  role: string;
}

// Simple hook to get current user from localStorage
function useAuth(): { user: User | null } {
  const router = useRouter();
  
  try {
    const authData = localStorage.getItem("goldensquirrel_auth");
    if (!authData) {
      return { user: null };
    }
    
    const parsed = JSON.parse(authData);
    return {
      user: {
        id: parsed.store_id || "",
        store_id: parsed.store_id || "",
        role: "owner" // Default role for POS system
      }
    };
  } catch {
    return { user: null };
  }
}

// Simple permission check - POS system doesn't use complex roles
function hasPermission(userRole: string, permission: string): boolean {
  return true; // POS system allows all operations
}

function hasRolePermission(userRole: string, minRole: string): boolean {
  return true; // POS system allows all operations
}

const PERMISSIONS = {};

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: string[];
  fallback?: React.ReactNode;
}

// Component that only renders children if user has one of the allowed roles
export function RoleGuard({ children, allowedRoles, fallback = null }: RoleGuardProps) {
  const { user } = useAuth();
  
  if (!user) return null;
  
  const hasAccess = allowedRoles.includes(user.role);
  
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

interface PermissionGuardProps {
  children: React.ReactNode;
  permission: string;
  fallback?: React.ReactNode;
}

// Component that only renders children if user has the specific permission
export function PermissionGuard({ children, permission, fallback = null }: PermissionGuardProps) {
  const { user } = useAuth();
  
  if (!user) return null;
  
  const hasAccess = hasPermission(user.role, permission);
  
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

interface HierarchyGuardProps {
  children: React.ReactNode;
  minRole: string;
  fallback?: React.ReactNode;
}

// Component that renders children if user meets minimum role hierarchy
export function HierarchyGuard({ children, minRole, fallback = null }: HierarchyGuardProps) {
  const { user } = useAuth();
  
  if (!user) return null;
  
  const hasAccess = hasRolePermission(user.role, minRole);
  
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

// Hook for checking permissions in components
export function useRoleAccess() {
  const { user } = useAuth();
  
  const checkPermission = (permission: string): boolean => {
    if (!user) return false;
    return hasPermission(user.role, permission);
  };
  
  const checkRole = (allowedRoles: string[]): boolean => {
    if (!user) return false;
    return allowedRoles.includes(user.role);
  };
  
  const checkHierarchy = (minRole: string): boolean => {
    if (!user) return false;
    return hasRolePermission(user.role, minRole);
  };
  
  const isWaiter = user?.role === "waiter";
  const isHost = user?.role === "host";
  const isManager = user?.role === "manager";
  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "admin";
  const isManagement = isManager || isOwner || isAdmin;
  
  return {
    user,
    role: user?.role,
    checkPermission,
    checkRole,
    checkHierarchy,
    isWaiter,
    isHost,
    isManager,
    isOwner,
    isAdmin,
    isManagement,
  };
}

// Higher-order component for role-based access
export function withRoleAccess<P extends object>(
  Component: React.ComponentType<P>,
  allowedRoles: string[]
) {
  return function WithRoleAccessWrapper(props: P) {
    const { user } = useAuth();
    
    if (!user || !allowedRoles.includes(user.role)) {
      return (
        <div className="p-8 text-center">
          <p className="text-muted-foreground">You don't have permission to access this feature.</p>
        </div>
      );
    }
    
    return <Component {...props} />;
  };
}

// Button wrapper that disables/hides based on role
interface RoleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  allowedRoles: string[];
  hideWhenUnauthorized?: boolean;
}

export function RoleButton({ 
  children, 
  allowedRoles, 
  hideWhenUnauthorized = false,
  ...props 
}: RoleButtonProps) {
  const { user } = useAuth();
  
  if (!user) return null;
  
  const hasAccess = allowedRoles.includes(user.role);
  
  if (!hasAccess && hideWhenUnauthorized) {
    return null;
  }
  
  return (
    <button disabled={!hasAccess} {...props}>
      {children}
    </button>
  );
}

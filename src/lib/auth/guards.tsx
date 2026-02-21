// =============================================
// Role-Based Access Control Components
// =============================================

import React from "react";
import { useRestaurant } from "@/app/RestaurantContext";
import { UserRole } from "@/lib/types/database";
import { hasPermission, hasRolePermission, PERMISSIONS } from "./roles";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  fallback?: React.ReactNode;
}

// Component that only renders children if user has one of the allowed roles
export function RoleGuard({ children, allowedRoles, fallback = null }: RoleGuardProps) {
  const { user } = useRestaurant();
  
  if (!user) return null;
  
  const hasAccess = allowedRoles.includes(user.role);
  
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

interface PermissionGuardProps {
  children: React.ReactNode;
  permission: keyof typeof PERMISSIONS;
  fallback?: React.ReactNode;
}

// Component that only renders children if user has the specific permission
export function PermissionGuard({ children, permission, fallback = null }: PermissionGuardProps) {
  const { user } = useRestaurant();
  
  if (!user) return null;
  
  const hasAccess = hasPermission(user.role, permission);
  
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

interface HierarchyGuardProps {
  children: React.ReactNode;
  minRole: UserRole;
  fallback?: React.ReactNode;
}

// Component that renders children if user meets minimum role hierarchy
export function HierarchyGuard({ children, minRole, fallback = null }: HierarchyGuardProps) {
  const { user } = useRestaurant();
  
  if (!user) return null;
  
  const hasAccess = hasRolePermission(user.role, minRole);
  
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

// Hook for checking permissions in components
export function useRoleAccess() {
  const { user } = useRestaurant();
  
  const checkPermission = (permission: keyof typeof PERMISSIONS): boolean => {
    if (!user) return false;
    return hasPermission(user.role, permission);
  };
  
  const checkRole = (allowedRoles: UserRole[]): boolean => {
    if (!user) return false;
    return allowedRoles.includes(user.role);
  };
  
  const checkHierarchy = (minRole: UserRole): boolean => {
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
  allowedRoles: UserRole[]
) {
  return function WithRoleAccessWrapper(props: P) {
    const { user } = useRestaurant();
    
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
  allowedRoles: UserRole[];
  hideWhenUnauthorized?: boolean;
}

export function RoleButton({ 
  children, 
  allowedRoles, 
  hideWhenUnauthorized = false,
  ...props 
}: RoleButtonProps) {
  const { user } = useRestaurant();
  
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

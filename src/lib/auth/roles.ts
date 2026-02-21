// =============================================
// Role-Based Access Control Configuration
// =============================================

import type { UserRole } from "@/lib/types/database";

// Re-export UserRole for convenience
export type { UserRole } from "@/lib/types/database";

// Navigation items configuration with role-based visibility
export interface NavItem {
  href: string;
  label: string;
  icon: string; // Icon name from lucide-react
  roles: UserRole[];
}

// Define which roles can access each navigation item
export const ROLE_BASED_NAV_ITEMS: NavItem[] = [
  // Dashboard - All roles except waiter (waiter goes to mobile)
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ["owner", "admin", "manager", "host"] },
  
  // Analytics - Manager and above
  { href: "/analytics", label: "Analytics", icon: "BarChart3", roles: ["owner", "admin", "manager"] },
  
  // Reservations - Host and above
  { href: "/reservations", label: "Reservations", icon: "Calendar", roles: ["owner", "admin", "manager", "host"] },
  
  // Waitlist - Host and above
  { href: "/waitlist", label: "Waitlist", icon: "List", roles: ["owner", "admin", "manager", "host"] },
  
  // Customers - Host and above (hosts can create, others full access)
  { href: "/customers", label: "Customers", icon: "Users", roles: ["owner", "admin", "manager", "host"] },
  
  // Floor Plan - Host and above
  { href: "/floor-plan", label: "Floor Plan", icon: "Grid3X3", roles: ["owner", "admin", "manager", "host"] },
  
  // Waiter View - Manager and above (for monitoring)
  { href: "/waiter", label: "Waiter View", icon: "ChefHat", roles: ["owner", "admin", "manager"] },
  
  // Tables Management - Manager and above
  { href: "/settings/tables", label: "Tables", icon: "Table", roles: ["owner", "admin", "manager"] },
  
  // Settings - Manager and above (sensitive settings)
  { href: "/settings", label: "Settings", icon: "Settings", roles: ["owner", "admin", "manager"] },
];

// Role hierarchy for permission checks (higher index = more permissions)
export const ROLE_HIERARCHY: UserRole[] = ["waiter", "host", "manager", "admin", "owner"];

// Check if a role has permission based on hierarchy
export function hasRolePermission(userRole: UserRole, requiredRole: UserRole): boolean {
  const userLevel = ROLE_HIERARCHY.indexOf(userRole);
  const requiredLevel = ROLE_HIERARCHY.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}

// Get navigation items for a specific role
export function getNavItemsForRole(role: UserRole): NavItem[] {
  if (role === "waiter") {
    return []; // Waiters don't see dashboard nav, they go to mobile view
  }
  return ROLE_BASED_NAV_ITEMS.filter(item => item.roles.includes(role));
}

// Check if user can access a specific route
export function canAccessRoute(role: UserRole, route: string): boolean {
  if (role === "waiter") {
    // Waiters can only access waiter routes
    return route.startsWith("/waiter") || route === "/login";
  }
  
  // Management roles can access waiter view for monitoring
  if (route.startsWith("/waiter")) {
    return ["manager", "admin", "owner"].includes(role);
  }
  
  const navItem = ROLE_BASED_NAV_ITEMS.find(item => 
    route === item.href || route.startsWith(item.href + "/")
  );
  
  if (!navItem) {
    // If route is not in nav items, allow access (could be sub-routes)
    return true;
  }
  
  return navItem.roles.includes(role);
}

// Get default redirect path based on role
export function getDefaultRouteForRole(role: UserRole): string {
  switch (role) {
    case "waiter":
      return "/waiter";  // (mobile) is a route group, doesn't appear in URL
    case "host":
      return "/dashboard";
    case "manager":
      return "/dashboard";
    case "owner":
    case "admin":
      return "/dashboard";
    default:
      return "/dashboard";
  }
}

// Permission checks for specific actions
export const PERMISSIONS = {
  // User management
  MANAGE_USERS: ["owner", "admin"] as UserRole[],
  
  // Billing and subscription
  MANAGE_BILLING: ["owner", "admin"] as UserRole[],
  
  // Restaurant settings
  MANAGE_SETTINGS: ["owner", "admin"] as UserRole[],
  
  // Table management
  MANAGE_TABLES: ["owner", "admin", "manager"] as UserRole[],
  
  // Analytics and reports
  VIEW_ANALYTICS: ["owner", "admin", "manager"] as UserRole[],
  
  // Customer management
  CREATE_CUSTOMERS: ["owner", "admin", "manager", "host"] as UserRole[],
  EDIT_CUSTOMERS: ["owner", "admin", "manager"] as UserRole[], // Hosts can create but limited edit
  
  // Reservation management
  MANAGE_RESERVATIONS: ["owner", "admin", "manager", "host"] as UserRole[],
  
  // Waitlist management
  MANAGE_WAITLIST: ["owner", "admin", "manager", "host"] as UserRole[],
  
  // Floor plan
  VIEW_FLOOR_PLAN: ["owner", "admin", "manager", "host"] as UserRole[],
  
  // Waiter specific
  VIEW_ACTIVE_TABLES: ["owner", "admin", "manager", "host", "waiter"] as UserRole[],
  ADD_CUSTOMER_NOTES: ["owner", "admin", "manager", "host", "waiter"] as UserRole[],
  ADD_FEEDBACK: ["owner", "admin", "manager", "host", "waiter"] as UserRole[],
} as const;

// Check if role has specific permission
export function hasPermission(role: UserRole, permission: keyof typeof PERMISSIONS): boolean {
  return PERMISSIONS[permission].includes(role);
}

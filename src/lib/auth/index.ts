// =============================================
// Auth Module - Role-Based Access Control
// =============================================

export {
  // Role configuration
  ROLE_BASED_NAV_ITEMS,
  ROLE_HIERARCHY,
  PERMISSIONS,
  
  // Helper functions
  hasRolePermission,
  getNavItemsForRole,
  canAccessRoute,
  getDefaultRouteForRole,
  hasPermission,
} from "./roles";

export type { NavItem } from "./roles";

export {
  // Guard components
  RoleGuard,
  PermissionGuard,
  HierarchyGuard,
  RoleButton,
  
  // HOC
  withRoleAccess,
  
  // Hook
  useRoleAccess,
} from "./guards";

// Re-export UserRole for convenience
export type { UserRole } from "@/lib/types/database";

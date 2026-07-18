// =============================================
// Auth Module - Role-Based Access Control
// =============================================

export {
  // Permission sections
  SECTIONS,
  getDefaultPermissions,
  getFullPermissions,
  canAccess,
} from "./permissions";

export type { SectionKey, UserPermissions, StoreUser } from "./permissions";

export {
  // Guard component
  PermissionGuard,
  withPermissionGuard,
} from "./guards";

export {
  // Context provider and hook
  AuthProvider,
  useAuth,
} from "./AuthContext";

export {
  // Utility hooks and helpers
  usePermissionGuard,
  getCurrentUser,
  getStoreId,
  getUserDisplayName,
  hasSectionAccess,
} from "./usePermissionGuard";

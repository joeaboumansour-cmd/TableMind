// =============================================
// Permission Sections - Central Definition
// =============================================
// When adding a new section/feature in the future:
// 1. Add it to SECTIONS below
// 2. It will automatically appear as a toggle in the admin panel
// 3. Use canAccess(section) in your page to guard it

export const SECTIONS = {
  pos: { label: "Point of Sale", description: "Ring up sales and manage cart" },
  inventory: { label: "Inventory & Products", description: "View and manage products, prices, stock" },
  transactions: { label: "Transaction History", description: "View past sales and receipts" },
  receipts: { label: "View Receipts", description: "Access individual transaction receipts" },
} as const;

export type SectionKey = keyof typeof SECTIONS;

export interface UserPermissions {
  pos: boolean;
  inventory: boolean;
  transactions: boolean;
  receipts: boolean;
  [key: string]: boolean; // Allows future sections without type changes
}

export interface StoreUser {
  id: string;
  storeId: string;
  username: string;
  displayName: string;
  isOwner: boolean; // true = store owner (from stores table), false = employee
  permissions: UserPermissions;
}

/**
 * Get default permissions object (all false)
 */
export function getDefaultPermissions(): UserPermissions {
  const perms: UserPermissions = {
    pos: false,
    inventory: false,
    transactions: false,
    receipts: false,
  };
  return perms;
}

/**
 * Get full permissions (all true - for store owners)
 */
export function getFullPermissions(): UserPermissions {
  const perms: UserPermissions = {
    pos: true,
    inventory: true,
    transactions: true,
    receipts: true,
  };
  return perms;
}

/**
 * Check if a user can access a specific section
 */
export function canAccess(user: StoreUser | null, section: SectionKey): boolean {
  if (!user) return false;
  return user.permissions[section] === true;
}
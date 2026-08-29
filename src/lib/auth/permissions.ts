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
  cash_register: { label: "Cash Register", description: "View and reconcile the daily cash drawer" },
  kitchen: { label: "Kitchen Display", description: "See paid orders and move them through preparation" },
} as const;

export type SectionKey = keyof typeof SECTIONS;

export interface UserPermissions {
  pos: boolean;
  inventory: boolean;
  transactions: boolean;
  receipts: boolean;
  cash_register: boolean;
  kitchen: boolean;
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
    cash_register: false,
    kitchen: false,
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
    cash_register: true,
    kitchen: true,
  };
  return perms;
}

/**
 * Parse a raw `store_users.permissions` value into a complete UserPermissions.
 *
 * Every section is derived from SECTIONS, so adding a section here is the only
 * edit needed — this used to be hand-written three times in AuthContext, each
 * copy listing the five keys literally, which meant a new section silently
 * arrived as `undefined` (falsy, so it read as "denied") at every call site
 * that had not been updated.
 *
 * Anything unparseable becomes all-false rather than throwing. A permissions
 * blob we cannot read is not permission to do anything — the safe direction
 * for a section gate is always to withhold.
 */
export function parsePermissions(raw: unknown): UserPermissions {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return getDefaultPermissions();
    }
  }

  if (!parsed || typeof parsed !== "object") return getDefaultPermissions();

  const source = parsed as Record<string, unknown>;
  const perms = getDefaultPermissions();
  for (const key of Object.keys(SECTIONS)) {
    perms[key] = source[key] === true;
  }
  return perms;
}

/**
 * Check if a user can access a specific section
 */
export function canAccess(user: StoreUser | null, section: SectionKey): boolean {
  if (!user) return false;
  return user.permissions[section] === true;
}
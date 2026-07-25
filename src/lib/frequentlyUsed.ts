// =============================================
// Frequently Used Products — Local Storage
// =============================================
// Manages a per-store list of "frequently used" product IDs
// that are shown as quick-access buttons in desktop mode.
// Stored in localStorage (keyed by store ID) so it works offline.
// =============================================

const STORAGE_KEY_PREFIX = "tm_frequently_used_";
const MAX_FREQUENTLY_USED = 12;

/**
 * Get the list of frequently used product IDs for a store.
 */
export function getFrequentlyUsedProductIds(storeId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `${STORAGE_KEY_PREFIX}${storeId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Add a product to the frequently used list (moves to front if already present).
 */
export function addFrequentlyUsedProduct(storeId: string, productId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_KEY_PREFIX}${storeId}`;
    const ids = getFrequentlyUsedProductIds(storeId);
    if (!ids.includes(productId)) {
      ids.unshift(productId);
      const trimmed = ids.slice(0, MAX_FREQUENTLY_USED);
      localStorage.setItem(key, JSON.stringify(trimmed));
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Remove a product from the frequently used list.
 */
export function removeFrequentlyUsedProduct(storeId: string, productId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORAGE_KEY_PREFIX}${storeId}`;
    const ids = getFrequentlyUsedProductIds(storeId);
    const filtered = ids.filter((id) => id !== productId);
    localStorage.setItem(key, JSON.stringify(filtered));
  } catch {
    // Ignore errors
  }
}

/**
 * Check if a product is in the frequently used list.
 */
export function isFrequentlyUsed(storeId: string, productId: string): boolean {
  return getFrequentlyUsedProductIds(storeId).includes(productId);
}

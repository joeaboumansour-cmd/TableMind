// =============================================
// Offline Auth Utilities
// Caches login credentials for offline login fallback
// =============================================

const OFFLINE_CREDENTIALS_KEY = "goldensquirrel_offline_credentials";

export interface CachedStoreData {
  id: string;
  username: string;
  password_hash: string;
  license_expires_at: string;
}

export interface CachedEmployeeData {
  id: string;
  store_id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  is_active: boolean;
  permissions: any;
}

export interface CachedCredentials {
  storeUsername: string;
  password: string;
  storeData: CachedStoreData;
  employeeData?: CachedEmployeeData | null;
  cachedAt: number;
}

/**
 * Cache credentials after a successful online login.
 * This allows the user to log in again while offline.
 */
export function cacheCredentials(
  storeUsername: string,
  password: string,
  storeData: CachedStoreData,
  employeeData?: CachedEmployeeData | null
): void {
  try {
    const credentials: CachedCredentials = {
      storeUsername,
      password,
      storeData,
      employeeData: employeeData || null,
      cachedAt: Date.now(),
    };
    localStorage.setItem(OFFLINE_CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch (e) {
    console.warn("[OfflineAuth] Failed to cache credentials:", e);
  }
}

/**
 * Retrieve cached credentials from localStorage.
 * Returns null if no credentials are cached or parsing fails.
 */
export function getCachedCredentials(): CachedCredentials | null {
  try {
    const raw = localStorage.getItem(OFFLINE_CREDENTIALS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedCredentials;
  } catch {
    return null;
  }
}

/**
 * Check if cached credentials match the provided store username and password.
 * Returns the store/employee data if credentials match, null otherwise.
 */
export function validateCachedCredentials(
  storeUsername: string,
  password: string
): { storeData: CachedStoreData; employeeData?: CachedEmployeeData | null } | null {
  const cached = getCachedCredentials();
  if (!cached) return null;

  // Check if the store username and password match the cached credentials
  if (
    cached.storeUsername === storeUsername.trim() &&
    cached.password === password
  ) {
    return { storeData: cached.storeData, employeeData: cached.employeeData };
  }

  return null;
}

/**
 * Check if cached credentials exist for a specific store username.
 * Used to pre-fill the login form or show a "Login with cached credentials" option.
 */
export function hasCachedCredentialsForStore(storeUsername: string): boolean {
  const cached = getCachedCredentials();
  if (!cached) return false;
  return cached.storeUsername === storeUsername.trim();
}

/**
 * Clear cached credentials (called on logout).
 */
export function clearCachedCredentials(): void {
  try {
    localStorage.removeItem(OFFLINE_CREDENTIALS_KEY);
  } catch (e) {
    // ignore
  }
}

/**
 * Check if any cached credentials are available.
 */
export function hasCachedCredentials(): boolean {
  return getCachedCredentials() !== null;
}

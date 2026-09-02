// =============================================
// Offline Auth Utilities
// Caches login credentials so a till can still sign in during an outage.
// =============================================
//
// WHY THIS IS A LIST AND NOT A SINGLE OBJECT
//
// This used to cache exactly ONE credential set under one key, overwritten on
// every successful online login. Two consequences, both found by testing the
// offline login flow on production (audit P1-10):
//
//   1. Last-online-login wins. In a shop with an owner and three cashiers,
//      whoever authenticated online most recently was the ONLY person who could
//      sign in during an outage. Everyone else was locked out of the till until
//      the internet came back — in the exact situation offline support exists
//      for.
//
//   2. Employee entries were keyed wrong anyway. `loginEmployee` cached with
//      the EMPLOYEE's username in the `storeUsername` field, while the login
//      form asks for the STORE username, so an employee entry could never be
//      matched. Employee offline login did not work at all.
//
// Entries are now keyed by (storeUsername, username), so everyone who has
// signed in online on this device keeps their own offline entry.
//
// NOTE ON SECRETS: these are plaintext passwords in localStorage. That is a
// pre-existing property of this app (audit P0-4) and is NOT made worse here —
// the same secret was already stored, just one at a time. It belongs to the
// wider auth rework, not to a fix for offline access.

const LEGACY_KEY = "goldensquirrel_offline_credentials";
const STORE_KEY = "goldensquirrel_offline_credentials_v2";

/** Keep the list bounded; a till serves a handful of people, not hundreds. */
const MAX_ENTRIES = 25;

// NOTE ON `password_hash`: it used to be copied in here alongside the entry's
// plaintext `password`, back when the browser did the comparison and therefore
// had the column. Nothing ever READ it — offline validation matches on
// `entry.password` below — so now that login is server-side and the column
// never leaves the database, it is simply not written. Optional rather than
// removed so an entry cached by an older build still parses.
export interface CachedStoreData {
  id: string;
  username: string;
  password_hash?: string;
  license_expires_at: string;
}

export interface CachedEmployeeData {
  id: string;
  store_id: string;
  username: string;
  password_hash?: string;
  display_name: string | null;
  is_active: boolean;
  permissions: unknown;
}

export interface CachedCredentialEntry {
  /** The STORE's username — what the login form's first field asks for. */
  storeUsername: string;
  /** The person's own username. Equal to storeUsername for an owner login. */
  username: string;
  password: string;
  storeData: CachedStoreData;
  employeeData?: CachedEmployeeData | null;
  cachedAt: number;
}

interface CredentialStoreV2 {
  version: 2;
  entries: CachedCredentialEntry[];
}

/** Back-compat shape written by the old single-slot implementation. */
interface LegacyCachedCredentials {
  storeUsername: string;
  password: string;
  storeData: CachedStoreData;
  employeeData?: CachedEmployeeData | null;
  cachedAt: number;
}

const norm = (s: string) => (s || "").trim().toLowerCase();
const identity = (storeUsername: string, username: string) =>
  norm(storeUsername) + "::" + norm(username);

/**
 * Read the entry list, folding in anything left by the old single-slot format.
 *
 * The legacy key is READ but never deleted. A device mid-upgrade must not lose
 * its only offline credential because a migration ran at an awkward moment —
 * being unable to open the till is far worse than a stale duplicate.
 */
function readEntries(): CachedCredentialEntry[] {
  const entries: CachedCredentialEntry[] = [];

  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CredentialStoreV2;
      if (parsed && Array.isArray(parsed.entries)) entries.push(...parsed.entries);
    }
  } catch {
    // corrupt store — fall through to the legacy entry rather than locking out
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as LegacyCachedCredentials;
      if (legacy && legacy.storeUsername && legacy.password) {
        // The legacy record has no separate `username`. An owner record's
        // username IS the store username; an employee record has it on
        // employeeData. Anything else falls back to the store username, which
        // is exactly how the old code behaved.
        const username =
          legacy.employeeData?.username ||
          legacy.storeData?.username ||
          legacy.storeUsername;
        const id = identity(legacy.storeUsername, username);
        if (!entries.some((e) => identity(e.storeUsername, e.username) === id)) {
          entries.push({
            storeUsername: legacy.storeUsername,
            username,
            password: legacy.password,
            storeData: legacy.storeData,
            employeeData: legacy.employeeData ?? null,
            cachedAt: legacy.cachedAt ?? 0,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return entries;
}

function writeEntries(entries: CachedCredentialEntry[]): void {
  const trimmed = [...entries]
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(0, MAX_ENTRIES);
  const payload: CredentialStoreV2 = { version: 2, entries: trimmed };
  localStorage.setItem(STORE_KEY, JSON.stringify(payload));
}

/**
 * Record credentials after a successful ONLINE login so this person can sign in
 * again while offline. Upserts by (storeUsername, username) — signing in again
 * refreshes your own entry and leaves colleagues' entries alone.
 */
export function cacheCredentials(
  storeUsername: string,
  username: string,
  password: string,
  storeData: CachedStoreData,
  employeeData?: CachedEmployeeData | null
): void {
  try {
    const id = identity(storeUsername, username);
    const entries = readEntries().filter(
      (e) => identity(e.storeUsername, e.username) !== id
    );
    entries.push({
      storeUsername: storeUsername.trim(),
      username: username.trim(),
      password,
      storeData,
      employeeData: employeeData || null,
      cachedAt: Date.now(),
    });
    writeEntries(entries);
  } catch (e) {
    console.warn("[OfflineAuth] Failed to cache credentials:", e);
  }
}

/**
 * Validate a store username + password (+ optional person username) against
 * the cache.
 *
 * `username` is optional so the older two-argument call shape keeps working. If
 * omitted, we match on store + password alone, which is what the previous
 * implementation did.
 */
export function validateCachedCredentials(
  storeUsername: string,
  password: string,
  username?: string
): { storeData: CachedStoreData; employeeData?: CachedEmployeeData | null } | null {
  const entries = readEntries();
  const store = norm(storeUsername);

  const candidates = entries.filter((e) => norm(e.storeUsername) === store);
  if (candidates.length === 0) return null;

  // Prefer an exact (store, username) match when a username was supplied.
  if (username && username.trim()) {
    const exact = candidates.find((e) => norm(e.username) === norm(username));
    if (exact) {
      // Right person, wrong password — fail rather than falling through to
      // some other colleague's entry that happens to share the password.
      return exact.password === password
        ? { storeData: exact.storeData, employeeData: exact.employeeData }
        : null;
    }
  }

  // No username given, or no entry for that username: accept any entry on this
  // store whose password matches. Preserves the previous behaviour.
  const byPassword = candidates.find((e) => e.password === password);
  return byPassword
    ? { storeData: byPassword.storeData, employeeData: byPassword.employeeData }
    : null;
}

/** Any offline credentials at all on this device? */
export function hasCachedCredentials(): boolean {
  return readEntries().length > 0;
}

/** Are there offline credentials for this particular store? */
export function hasCachedCredentialsForStore(storeUsername: string): boolean {
  const store = norm(storeUsername);
  return readEntries().some((e) => norm(e.storeUsername) === store);
}

/** Distinct store usernames held on this device, most recently cached first. */
export function getCachedStoreUsernames(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of readEntries().sort((a, b) => b.cachedAt - a.cachedAt)) {
    const k = norm(e.storeUsername);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e.storeUsername);
    }
  }
  return out;
}

/** Usernames cached for a store — used to tell the cashier who can sign in. */
export function getCachedUsernamesForStore(storeUsername: string): string[] {
  const store = norm(storeUsername);
  return readEntries()
    .filter((e) => norm(e.storeUsername) === store)
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .map((e) => e.username);
}

/**
 * The most recently cached entry, for pre-filling the login form.
 * Replaces the old single-slot getCachedCredentials().
 */
export function getMostRecentCachedEntry(): CachedCredentialEntry | null {
  const entries = readEntries().sort((a, b) => b.cachedAt - a.cachedAt);
  return entries[0] ?? null;
}

/**
 * Remove every cached credential on this device.
 *
 * Deliberately NOT called on logout — see clearUserFromStorage in AuthContext.
 * Wiping these on sign-out is what would strand a cashier who signs out at the
 * end of a shift during an outage.
 */
export function clearCachedCredentials(): void {
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}

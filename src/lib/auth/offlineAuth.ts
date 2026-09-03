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

import {
  evaluatePin,
  cooldownRemaining,
  attemptsRemaining,
  isWellFormedPin,
  isWeakPin,
  type PinVerdict,
} from "./pinPolicy";

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

  // ---- Quick-unlock PIN (all optional; see the version note below) ----
  //
  // Plaintext, deliberately, sitting beside the plaintext `password` above.
  // Hashing it would buy nothing: anyone who can read one field can read the
  // other. The protection that matters is the attempt throttle in pinPolicy.ts,
  // whose counters are the three fields after it.
  /** The person's 4-digit PIN on THIS device. Absent means no PIN set. */
  pin?: string;
  pinSetAt?: number;
  pinFailedAttempts?: number;
  pinLockedUntil?: number;
  /** When they last said "not now" to the PIN setup offer. */
  pinPromptDismissedAt?: number;
}

/**
 * NOTE ON `version`: it stays 2, and the PIN fields above are all optional.
 *
 * Everything added is additive, and readEntries() has never validated field by
 * field, so an entry written before PINs existed parses unchanged and simply
 * reads as "no PIN". Bumping to 3 would buy nothing and create a real hazard:
 * a till whose service worker rolls back to an older bundle would meet a blob
 * the older reader does not expect. The read type is widened defensively; the
 * writer keeps emitting 2.
 */
interface CredentialStoreV2 {
  version: 2 | 3;
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
    const all = readEntries();
    const previous = all.find((e) => identity(e.storeUsername, e.username) === id);
    const entries = all.filter((e) => identity(e.storeUsername, e.username) !== id);
    entries.push({
      storeUsername: storeUsername.trim(),
      username: username.trim(),
      password,
      storeData,
      employeeData: employeeData || null,
      cachedAt: Date.now(),
      // The PIN survives a fresh online sign-in. It belongs to the DEVICE, not
      // to the session — silently clearing it here would mean anyone who ever
      // typed their password again lost their quick unlock without being told.
      // The throttle counters ride along with it, so signing in with the
      // password is not a way to reset a cooldown.
      pin: previous?.pin,
      pinSetAt: previous?.pinSetAt,
      pinFailedAttempts: previous?.pinFailedAttempts,
      pinLockedUntil: previous?.pinLockedUntil,
      pinPromptDismissedAt: previous?.pinPromptDismissedAt,
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

// =============================================
// Quick-unlock PIN and the login roster
//
// The roster is the list of people this DEVICE has seen sign in — the same
// entries offline login has always used, now surfaced as avatar chips so a
// cashier coming back from a break taps their face and four digits instead of
// typing three fields.
//
// Nothing below may throw out of the module. A corrupt blob must degrade to
// "no PIN, use your password", never to a till that cannot be opened.
// =============================================

/** One person the till can offer on the login screen. Carries no presentation. */
export interface RosterEntry {
  storeUsername: string;
  username: string;
  displayName: string;
  isOwner: boolean;
  hasPin: boolean;
  cachedAt: number;
  /** Epoch ms while the pad is cold for this person, else null. */
  pinLockedUntil: number | null;
  attemptsRemaining: number;
}

function findEntry(
  storeUsername: string,
  username: string
): CachedCredentialEntry | null {
  const id = identity(storeUsername, username);
  return (
    readEntries().find((e) => identity(e.storeUsername, e.username) === id) ?? null
  );
}

/** Replace one entry in place, leaving colleagues' entries untouched. */
function patchEntry(
  storeUsername: string,
  username: string,
  patch: Partial<CachedCredentialEntry>
): void {
  try {
    const id = identity(storeUsername, username);
    const entries = readEntries();
    const index = entries.findIndex(
      (e) => identity(e.storeUsername, e.username) === id
    );
    if (index === -1) return;
    entries[index] = { ...entries[index], ...patch };
    writeEntries(entries);
  } catch (e) {
    console.warn("[OfflineAuth] Failed to update cached entry:", e);
  }
}

function toRosterEntry(e: CachedCredentialEntry): RosterEntry {
  const now = Date.now();
  const cooling = cooldownRemaining(e, now);
  return {
    storeUsername: e.storeUsername,
    username: e.username,
    // An owner has no store_users row, so their store username IS their name.
    displayName: e.employeeData?.display_name || e.username,
    isOwner: !e.employeeData,
    hasPin: Boolean(e.pin),
    cachedAt: e.cachedAt,
    pinLockedUntil: cooling > 0 ? now + cooling : null,
    attemptsRemaining: attemptsRemaining(e),
  };
}

/** Everyone this device can offer for a store, most recently seen first. */
export function getRosterForStore(storeUsername: string): RosterEntry[] {
  try {
    const store = norm(storeUsername);
    return readEntries()
      .filter((e) => norm(e.storeUsername) === store)
      .sort((a, b) => b.cachedAt - a.cachedAt)
      .map(toRosterEntry);
  } catch {
    return [];
  }
}

export function getRosterEntry(
  storeUsername: string,
  username: string
): RosterEntry | null {
  try {
    const entry = findEntry(storeUsername, username);
    return entry ? toRosterEntry(entry) : null;
  } catch {
    return null;
  }
}

/**
 * Check a PIN and persist the resulting throttle state.
 *
 * Returns the whole entry on success because the caller needs `storeData` and
 * `employeeData` to rebuild the session — see establishSessionFromCache in
 * AuthContext, which is the ONLY thing that should consume it.
 */
export function verifyPin(
  storeUsername: string,
  username: string,
  pin: string
): { verdict: PinVerdict; entry: CachedCredentialEntry | null } {
  let entry: CachedCredentialEntry | null = null;
  try {
    entry = findEntry(storeUsername, username);
  } catch {
    entry = null;
  }

  const { verdict, next } = evaluatePin(entry, pin, Date.now());

  // Persist the counters even on failure — that IS the throttle. Skipped when
  // there is no entry, since there is nothing to patch.
  if (entry) {
    patchEntry(storeUsername, username, {
      pinFailedAttempts: next.pinFailedAttempts,
      pinLockedUntil: next.pinLockedUntil,
    });
  }

  return { verdict, entry: verdict.ok ? entry : null };
}

export function setPin(
  storeUsername: string,
  username: string,
  pin: string
): { ok: true } | { ok: false; error: "malformed" | "weak" | "no_entry" } {
  if (!isWellFormedPin(pin)) return { ok: false, error: "malformed" };
  if (isWeakPin(pin)) return { ok: false, error: "weak" };

  const entry = findEntry(storeUsername, username);
  // A PIN unlocks a cached credential. With no credential to unlock there is
  // nothing for it to mean, so this is refused rather than stored dangling.
  if (!entry) return { ok: false, error: "no_entry" };

  patchEntry(storeUsername, username, {
    pin,
    pinSetAt: Date.now(),
    pinFailedAttempts: 0,
    pinLockedUntil: undefined,
    pinPromptDismissedAt: undefined,
  });
  return { ok: true };
}

/** Remove the PIN but keep the cached credential — password login still works. */
export function clearPin(storeUsername: string, username: string): void {
  patchEntry(storeUsername, username, {
    pin: undefined,
    pinSetAt: undefined,
    pinFailedAttempts: undefined,
    pinLockedUntil: undefined,
  });
}

export function hasPin(storeUsername: string, username: string): boolean {
  try {
    return Boolean(findEntry(storeUsername, username)?.pin);
  } catch {
    return false;
  }
}

export function markPinPromptDismissed(storeUsername: string, username: string): void {
  patchEntry(storeUsername, username, { pinPromptDismissedAt: Date.now() });
}

/** Re-offer a declined PIN setup after this long, not on every single login. */
const PIN_PROMPT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldOfferPinSetup(storeUsername: string, username: string): boolean {
  try {
    const entry = findEntry(storeUsername, username);
    if (!entry) return false;
    if (entry.pin) return false;
    if (!entry.pinPromptDismissedAt) return true;
    return Date.now() - entry.pinPromptDismissedAt > PIN_PROMPT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * Forget ONE person on this device — their password, their PIN, everything.
 *
 * Deliberately per-entry, and deliberately NOT a rename of
 * clearCachedCredentials() above, which still has no callers on purpose.
 * Wiping the whole cache is what would strand a colleague mid-outage; removing
 * one person is what an explicit "not me / forget this account" tap means, and
 * what a CONFIRMED deactivation means (see unlockWithPin in AuthContext —
 * without it a dismissed employee could PIN straight back in offline).
 */
export function forgetCachedEntry(storeUsername: string, username: string): void {
  try {
    const id = identity(storeUsername, username);
    writeEntries(
      readEntries().filter((e) => identity(e.storeUsername, e.username) !== id)
    );
  } catch (e) {
    console.warn("[OfflineAuth] Failed to forget cached entry:", e);
  }
}

/**
 * Forget one person, addressed by STORE ID rather than store username.
 *
 * The session only carries `store_id` (that is all `goldensquirrel_auth` holds),
 * so a caller acting on a live session — a confirmed deactivation, say — cannot
 * name the store username this cache is keyed by. This resolves it from the
 * cached storeData instead.
 */
export function forgetCachedEntryByStoreId(storeId: string, username: string): void {
  try {
    const user = norm(username);
    writeEntries(
      readEntries().filter((e) => {
        const sameStore =
          e.storeData?.id === storeId || e.employeeData?.store_id === storeId;
        return !(sameStore && norm(e.username) === user);
      })
    );
  } catch (e) {
    console.warn("[OfflineAuth] Failed to forget cached entry by store id:", e);
  }
}

/**
 * The store username this device cached for a given store id.
 *
 * A live session only carries `store_id` (that is all goldensquirrel_auth
 * holds), but this cache — and therefore the roster — is keyed by the store
 * USERNAME. Anything acting from inside a session (locking the till, say) has
 * to cross that gap here.
 */
export function getCachedStoreUsernameForStoreId(storeId: string): string | null {
  try {
    const match = readEntries()
      .filter((e) => e.storeData?.id === storeId || e.employeeData?.store_id === storeId)
      .sort((a, b) => b.cachedAt - a.cachedAt)[0];
    return match?.storeUsername ?? null;
  } catch {
    return null;
  }
}

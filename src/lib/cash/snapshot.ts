// =============================================
// Last-known cash page state
// =============================================
// The cash page used to render a spinner until a ten-round-trip API call came
// back. The transactions and inventory screens feel instant because they do the
// opposite: paint whatever they already have, then quietly revalidate. This is
// that cache for the cash page.
//
// It also makes the page WORK OFFLINE. Opening, closing and adjusting a shift
// already queue through pending_writes, but the screen those actions live on
// could not render without a network round trip, so in practice none of them
// were reachable during an outage. Now the page opens from the snapshot and the
// writes queue as designed.
//
// **localStorage, not Dexie, on purpose.** The payload is a handful of
// registers and shifts — small, single-store, and read exactly once per page
// load. Dexie would mean an append-only schema version bump for something with
// no index and no query behind it.
//
// A snapshot is a display convenience, never a source of truth. It is only ever
// used to paint something while the real figures load, it carries the time it
// was taken so the UI can say how stale it is, and it is dropped on logout.
// =============================================

const KEY_PREFIX = "goldensquirrel_cash_snapshot_";

/** Older than this and the UI stops presenting it as current. */
export const SNAPSHOT_STALE_MS = 5 * 60_000;

export interface CashSnapshot {
  /** When this was captured, epoch ms. */
  at: number;
  registers: unknown[];
  employees: unknown[];
  shifts: unknown[];
  totals: Record<string, unknown>;
  adjustments: Record<string, unknown[]>;
  pendingByRegister: Record<string, number>;
  unassigned: { count: number; total: number } | null;
}

function keyFor(storeId: string): string {
  return `${KEY_PREFIX}${storeId}`;
}

export function readCashSnapshot(storeId: string | undefined | null): CashSnapshot | null {
  if (!storeId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyFor(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CashSnapshot;
    if (!parsed || typeof parsed.at !== "number" || !Array.isArray(parsed.registers)) return null;
    return parsed;
  } catch {
    // Corrupt or unreadable is the same as absent — the page just loads normally.
    return null;
  }
}

export function writeCashSnapshot(
  storeId: string | undefined | null,
  payload: Omit<CashSnapshot, "at">
): void {
  if (!storeId || typeof window === "undefined") return;
  try {
    localStorage.setItem(keyFor(storeId), JSON.stringify({ ...payload, at: Date.now() }));
  } catch {
    // A full or disabled storage must never break the page. Losing the cache
    // costs a spinner, nothing more.
  }
}

export function clearCashSnapshot(storeId: string | undefined | null): void {
  if (!storeId || typeof window === "undefined") return;
  try {
    localStorage.removeItem(keyFor(storeId));
  } catch {
    /* ignore */
  }
}

/** How old the snapshot is in whole minutes. */
export function snapshotAgeMinutes(snapshot: CashSnapshot | null): number {
  if (!snapshot) return 0;
  return Math.max(0, Math.floor((Date.now() - snapshot.at) / 60_000));
}

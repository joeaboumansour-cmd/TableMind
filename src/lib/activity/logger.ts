/**
 * The activity logger.
 *
 * `logActivity()` is the only thing the rest of the app touches. It is
 * synchronous, returns nothing, and cannot throw — a call site must never have
 * to think about whether logging worked, and a broken logger must never be
 * able to fail a sale.
 *
 * Everything heavy (Dexie, connectivity) is loaded lazily, the first time
 * logging is actually switched on for a store. That keeps the admin console —
 * which mounts the same provider tree but never logs — free of the offline
 * machinery, and keeps a disabled store paying nothing.
 *
 * On fidelity: this records ACTIONS and INTERACTIONS, not keypresses. A scan
 * is one event carrying the whole code; a text field is one event on commit
 * carrying its final value. Nothing a user entered is lost, but the
 * intermediate keystrokes are not stored — at till volume they would be
 * hundreds of thousands of rows a day per store, would capture passwords
 * character by character, and would fill the offline buffer that has to share
 * a disk with queued sales.
 */

import { readCallerIdentity, type CallerIdentity } from "@/lib/auth/requestHeaders";
import {
  ACTIVITY_LIMITS,
  categoryForAction,
  type ActivityAction,
  type ActivityEvent,
} from "./types";

const DEVICE_ID_KEY = "goldensquirrel_device_id";

/** Flush when this many events are waiting. */
const FLUSH_AT_COUNT = 50;
/** ...or when this long has passed, whichever comes first. */
const FLUSH_INTERVAL_MS = 5_000;
/** Hard cap on unflushed events held in memory. Past it, the oldest are dropped. */
const MEMORY_MAX = 500;
/** Identical consecutive events inside this window are collapsed into one. */
const DEDUPE_WINDOW_MS = 300;
/** How long a read of the signed-in identity is reused before re-reading localStorage. */
const IDENTITY_TTL_MS = 3_000;

type FlushModule = typeof import("./flush");

let enabled = false;
let buffer: ActivityEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushModule: FlushModule | null = null;

let sessionId: string | null = null;
let deviceId: string | undefined;

let identityCache: { at: number; value: CallerIdentity | null } | null = null;

let lastKey = "";
let lastKeyAt = 0;

// Connectivity is mirrored rather than queried, so logging an event costs no
// module lookup. `offlineSince` is kept here because connectivity itself does
// not expose the previous status, a transition timestamp, or lastProbeAt —
// the outage duration has to be measured by whoever cares about it.
let online = true;
let offlineSince: number | null = null;
let sawFirstConnectivityStatus = false;
let connectivityUnsub: (() => void) | null = null;

// ---- helpers ----------------------------------------------------------------

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getSessionId(): string {
  if (!sessionId) sessionId = newId();
  return sessionId;
}

/** Stable per browser profile, so one device's events group together across sessions. */
function getDeviceId(): string | undefined {
  if (deviceId) return deviceId;
  try {
    let stored = localStorage.getItem(DEVICE_ID_KEY);
    if (!stored) {
      stored = newId();
      localStorage.setItem(DEVICE_ID_KEY, stored);
    }
    deviceId = stored;
  } catch {
    // Private mode or blocked storage — events are still valid without it.
    deviceId = undefined;
  }
  return deviceId;
}

function getIdentity(): CallerIdentity | null {
  const now = Date.now();
  if (identityCache && now - identityCache.at < IDENTITY_TTL_MS) return identityCache.value;
  const value = readCallerIdentity();
  identityCache = { at: now, value };
  return value;
}

/** Called when the signed-in user changes, so the next event is attributed correctly. */
export function invalidateActivityIdentity(): void {
  identityCache = null;
}

function truncate(value: string): string {
  return value.length > ACTIVITY_LIMITS.maxStringLength
    ? `${value.slice(0, ACTIVITY_LIMITS.maxStringLength)}…`
    : value;
}

const SENSITIVE_KEY = /pass|secret|token|credential|pin\b|otp/i;

/**
 * Make an arbitrary details object safe and small.
 *
 * Defence in depth: the DOM tracker already refuses to read password inputs,
 * but an explicit call site could still hand over something sensitive by name,
 * so anything that looks like a credential is replaced here too.
 */
function sanitizeDetails(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};

  const out: Record<string, unknown> = {};
  let keys = 0;

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (++keys > 25) break;

    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[redacted]";
      continue;
    }

    if (typeof value === "string") {
      out[key] = truncate(value);
    } else if (typeof value === "number") {
      out[key] = Number.isFinite(value) ? value : null;
    } else if (typeof value === "boolean" || value === null) {
      out[key] = value;
    } else {
      try {
        out[key] = truncate(JSON.stringify(value) ?? "");
      } catch {
        out[key] = "[unserialisable]";
      }
    }
  }

  try {
    if (JSON.stringify(out).length > ACTIVITY_LIMITS.maxDetailsBytes) {
      return { _truncated: true, _keys: Object.keys(out).slice(0, 10) };
    }
  } catch {
    return { _truncated: true };
  }

  return out;
}

// ---- the public call --------------------------------------------------------

/**
 * Record something that happened. Fire and forget.
 *
 * Never awaited, never throws, never returns a promise — nothing on the money
 * path may be made slower or more fragile by the presence of a log call.
 */
export function logActivity(
  action: ActivityAction,
  opts?: {
    target?: string;
    details?: Record<string, unknown>;
    /**
     * Attribution to use instead of whatever is in localStorage.
     *
     * Needed at exactly one moment: a login, where the event happens BEFORE
     * the auth keys have been written and so cannot be attributed by reading
     * them. Everything else should leave this alone.
     */
    identity?: { store_id: string; user_id?: string; user_name?: string };
  }
): void {
  try {
    if (!enabled || typeof window === "undefined") return;

    const identity = opts?.identity ?? getIdentity();
    // No store means nobody is signed in — an event with no tenant has nowhere
    // to go, since store_id is NOT NULL and comes from the auth header anyway.
    if (!identity?.store_id) return;

    const target = opts?.target ? truncate(opts.target) : undefined;
    const category = categoryForAction(action);
    const now = Date.now();

    // Collapse repeats — but ONLY for the passive UI trail. Focus/blur thrash
    // and double-firing click handlers produce runs of identical rows that bury
    // the real actions. Semantic events are never collapsed: two "+" taps on
    // the same cart line inside 300ms are two real quantity changes, and losing
    // the second would misreport what the cashier did.
    if (category === "ui" || category === "nav") {
      const key = `${action}|${target ?? ""}`;
      if (key === lastKey && now - lastKeyAt < DEDUPE_WINDOW_MS) {
        lastKeyAt = now;
        return;
      }
      lastKey = key;
      lastKeyAt = now;
    }

    const event: ActivityEvent = {
      client_event_id: newId(),
      store_id: identity.store_id,
      // Captured NOW, not at flush time. logout() clears goldensquirrel_auth,
      // so a buffered event that looked this up later would have no tenant.
      user_id: identity.user_id,
      user_name: identity.user_name,
      session_id: getSessionId(),
      device_id: getDeviceId(),
      category,
      action,
      target,
      details: sanitizeDetails(opts?.details),
      route: window.location?.pathname,
      is_offline: !online,
      occurred_at: new Date(now).toISOString(),
    };

    buffer.push(event);

    if (buffer.length > MEMORY_MAX) {
      buffer = buffer.slice(buffer.length - MEMORY_MAX);
    }
    if (buffer.length >= FLUSH_AT_COUNT) {
      flushActivity();
    }
  } catch {
    // A logger that can break the thing it observes is worse than no logger.
  }
}

/** Hand whatever is buffered to the delivery layer. Safe to call at any time. */
export function flushActivity(): void {
  try {
    if (buffer.length === 0) return;

    const batch = buffer;
    buffer = [];

    if (flushModule) {
      // Already loaded — the fetch (with keepalive) is issued synchronously
      // inside, which is what makes a flush on pagehide actually leave.
      void flushModule.deliverActivityBatch(batch);
      return;
    }

    void import("./flush").then((mod) => {
      flushModule = mod;
      return mod.deliverActivityBatch(batch);
    });
  } catch {
    /* ignore */
  }
}

// ---- lifecycle --------------------------------------------------------------

function handleConnectivity(status: "online" | "offline"): void {
  // subscribe() fires immediately with the current status; that first call is
  // the starting state, not a transition, and must not be logged as one.
  if (!sawFirstConnectivityStatus) {
    sawFirstConnectivityStatus = true;
    online = status === "online";
    if (!online) offlineSince = Date.now();
    return;
  }

  if (status === "offline") {
    online = false;
    offlineSince = Date.now();
    logActivity("connectivity.offline");
    return;
  }

  const wentOfflineAt = offlineSince;
  online = true;
  offlineSince = null;

  // NOTE two limits worth knowing when reading these rows:
  //  - a tab can adopt a sibling tab's status over BroadcastChannel, so a
  //    multi-tab device records one outage per tab. session_id tells them apart.
  //  - the heartbeat is suspended while the tab is hidden, so an outage that
  //    both starts and ends in the background is never seen at all.
  logActivity("connectivity.online", {
    details:
      wentOfflineAt === null
        ? { offline_duration_ms: null }
        : {
            offline_duration_ms: Date.now() - wentOfflineAt,
            offline_duration_s: Math.round((Date.now() - wentOfflineAt) / 1000),
          },
  });
}

function onPageHide(): void {
  flushActivity();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    logActivity("ui.app_hidden");
    flushActivity();
  } else {
    logActivity("ui.app_visible");
  }
}

async function activate(): Promise<void> {
  const [connectivityMod, flushMod] = await Promise.all([
    import("@/lib/connectivity"),
    import("./flush"),
  ]);

  if (!enabled) return; // switched off while the imports were in flight

  flushModule = flushMod;
  flushMod.startActivityFlusher();

  if (!connectivityUnsub) {
    connectivityUnsub = connectivityMod.connectivity.subscribe(handleConnectivity);
  }
}

/**
 * Turn logging on or off for this device.
 *
 * Driven by the per-store `activity_logging` feature flag, which is the kill
 * switch: a store can be taken out of the trail from the admin feature dialog
 * with no deploy.
 */
export function setActivityLoggingEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;

  if (!enabled) {
    flushActivity();
    teardown();
    return;
  }

  if (typeof window === "undefined") return;

  if (flushTimer === null) {
    flushTimer = setInterval(flushActivity, FLUSH_INTERVAL_MS);
  }
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);

  void activate().catch((e) => {
    console.warn("[Activity] Could not start the logger:", e);
  });
}

export function isActivityLoggingEnabled(): boolean {
  return enabled;
}

function teardown(): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (connectivityUnsub) {
    connectivityUnsub();
    connectivityUnsub = null;
  }
  sawFirstConnectivityStatus = false;

  if (typeof window !== "undefined") {
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  flushModule?.stopActivityFlusher();
}

/**
 * persistentStorage — ask the browser to stop treating our data as disposable.
 *
 * Why this exists:
 *   `offline_queue` holds completed sales whose money was already taken at the
 *   till. localDB.ts says those rows are "never auto-deleted" — and that is
 *   true of OUR code. It is not true of the browser. By default an origin's
 *   storage is "best-effort", which means:
 *
 *     * iOS/Safari ITP clears all script-writable storage after 7 days without
 *       site interaction. A shop closed for a week comes back to an empty
 *       queue, an empty product cache, and no cached offline credentials — so
 *       nobody can even log in to find out what was lost.
 *     * Chrome/Android evicts non-persistent origins under storage pressure,
 *       a whole origin at a time.
 *
 *   `navigator.storage.persist()` moves the origin to "persistent", which
 *   exempts it from both. It was never called anywhere in this app.
 *
 * What actually grants it:
 *   Neither browser prompts. Chrome grants silently once the PWA is installed
 *   (or the site is sufficiently engaged); iOS grants for an installed
 *   home-screen app. So a denial is not an error — it is a signal that the
 *   user is running in a plain browser tab and should install the app. That is
 *   worth telling them once, and not worth nagging about.
 */

const PERSIST_NOTICE_KEY = "goldensquirrel_persist_notice_shown";

export type PersistResult = {
  /** True when the origin's storage is exempt from eviction. */
  persisted: boolean;
  /** False when the browser has no Storage API at all (old WebViews). */
  supported: boolean;
};

/**
 * Ensure the origin's storage is persistent. Safe to call repeatedly — it
 * checks `persisted()` first, so the grant path runs at most once per session.
 *
 * Never throws: this runs on app start and must not be able to break boot.
 */
export async function ensurePersistentStorage(): Promise<PersistResult> {
  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.persist !== "function" ||
      typeof navigator.storage.persisted !== "function"
    ) {
      return { persisted: false, supported: false };
    }

    if (await navigator.storage.persisted()) {
      return { persisted: true, supported: true };
    }

    const granted = await navigator.storage.persist();
    if (granted) {
      console.log("[Storage] Persistent storage granted — queued sales are now eviction-safe");
    } else {
      console.warn(
        "[Storage] Persistent storage DENIED. Queued sales may be evicted by the browser. Installing the PWA usually grants it."
      );
    }
    return { persisted: granted, supported: true };
  } catch (e) {
    console.warn("[Storage] persist() failed:", e);
    return { persisted: false, supported: false };
  }
}

export type StorageHealth = {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  /** 0-1. Zero when the browser reports no quota. */
  ratio: number;
  /** True past 80% — time to warn before a write actually fails. */
  nearFull: boolean;
};

/**
 * How close the origin is to its quota.
 *
 * Both numbers are deliberately coarse (browsers pad them for privacy), so
 * treat this as an early warning, not an accounting record. The point is to
 * surface a problem while there is still room to act, rather than discovering
 * it as a failed sale.
 */
export async function getStorageHealth(): Promise<StorageHealth> {
  const empty: StorageHealth = {
    supported: false,
    usageBytes: 0,
    quotaBytes: 0,
    ratio: 0,
    nearFull: false,
  };

  try {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.estimate !== "function"
    ) {
      return empty;
    }

    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const ratio = quota > 0 ? usage / quota : 0;
    return {
      supported: true,
      usageBytes: usage,
      quotaBytes: quota,
      ratio,
      nearFull: ratio >= 0.8,
    };
  } catch {
    return empty;
  }
}

/**
 * Whether we have already told this device that its storage is not persistent.
 * Callers use this to warn once rather than on every launch — the condition is
 * permanent until the user installs the app, so repeating it is just noise.
 */
export function hasShownPersistNotice(): boolean {
  try {
    return localStorage.getItem(PERSIST_NOTICE_KEY) === "true";
  } catch {
    return true; // no localStorage — assume shown rather than nag
  }
}

export function markPersistNoticeShown(): void {
  try {
    localStorage.setItem(PERSIST_NOTICE_KEY, "true");
  } catch {
    // ignore — a device that cannot write this flag has bigger problems
  }
}

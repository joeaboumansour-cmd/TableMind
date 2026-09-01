"use client";

// =============================================
// Durability — is this device a safe place to keep money?
// =============================================
// `offline_queue` holds completed sales whose cash is already in the drawer.
// Whether those rows survive is not a property of this app's code; it is a
// property of the BROWSER the till happens to be running in:
//
//   * Safari clears script-writable storage after 7 days without site
//     interaction — unless the app is installed to the home screen.
//   * Chrome evicts non-persistent origins under pressure, a whole origin at a
//     time.
//   * A full disk fails the next write, persisted or not.
//
// Phase 6.1 asks for that state to be visible to the shop and to the admin
// console. This is the part that decides WHAT the state is; who shows it is
// somebody else's problem.
//
// The classification is a pure function of facts, so it can be asserted
// directly — the same reason `evaluateReconcile()` is one.
// =============================================

import { getDeadLetterTransactions, getQueuedCount } from "@/lib/db/localDB";
import { ensurePersistentStorage, getStorageHealth } from "./persistentStorage";

export interface DurabilityFacts {
  /** False on a browser with no Storage API at all — an old WebView. */
  supported: boolean;
  /** The origin is exempt from eviction. */
  persisted: boolean;
  /** Past ~80% of quota: the next write may fail. */
  nearFull: boolean;
  /** 0-1, coarse — browsers pad these numbers for privacy. */
  usageRatio: number;
  /** Completed sales not yet on the server. THIS is what is at stake. */
  queuedSales: number;
  /** Sales the server refused past the retry cap. A different problem. */
  deadLettered: number;
}

/**
 * Ordered by severity, worst first. The banner reads the level; the admin trail
 * gets the facts.
 */
export type DurabilityLevel =
  /** Storage is nearly full — the next sale may fail to be written at all. */
  | "full"
  /** Money is queued on a device the browser is allowed to clear. */
  | "at_risk"
  /** Evictable, but nothing is queued yet. Worth saying once, not shouting. */
  | "unprotected"
  /** Persistent storage granted. Queued sales survive. */
  | "protected"
  /** No Storage API — we cannot know, and must not claim either answer. */
  | "unknown";

export interface Durability {
  level: DurabilityLevel;
  /** True when a person needs to act now. Drives whether anything is shown. */
  urgent: boolean;
  headline: string;
  detail: string;
  facts: DurabilityFacts;
}

/**
 * Classify. Pure — no storage, no network, no clock.
 *
 * Severity order is deliberate: a full disk outranks an evictable one because
 * it fails the NEXT sale, which is a certainty rather than a risk, and it does
 * so whether or not the grant was given.
 */
export function classifyDurability(facts: DurabilityFacts): Durability {
  const { supported, persisted, nearFull, queuedSales } = facts;

  if (!supported) {
    // An absent answer is not a negative answer — the rule this codebase keeps
    // relearning. Do not tell a shop its sales are safe, or that they are not.
    return {
      level: "unknown",
      urgent: false,
      headline: "Storage protection cannot be checked on this browser",
      detail:
        "This device is older than the storage API. Sales still queue and sync normally; " +
        "keep the app installed and sync often.",
      facts,
    };
  }

  if (nearFull) {
    return {
      level: "full",
      urgent: true,
      headline: "This device is almost out of storage",
      detail:
        queuedSales > 0
          ? `The next sale may fail to save, and ${queuedSales} unsynced ${queuedSales === 1 ? "sale is" : "sales are"} still on this device. Connect to the internet so they sync, then free up space.`
          : "The next sale may fail to save. Free up space on this device.",
      facts,
    };
  }

  if (!persisted && queuedSales > 0) {
    return {
      level: "at_risk",
      urgent: true,
      headline: `${queuedSales} unsynced ${queuedSales === 1 ? "sale is" : "sales are"} not protected`,
      detail:
        "This browser is allowed to delete them. Connect to the internet so they sync, " +
        "or install Golden Squirrel to the home screen to keep them safe.",
      facts,
    };
  }

  if (!persisted) {
    return {
      level: "unprotected",
      urgent: false,
      headline: "Install the app to protect offline sales",
      detail:
        "In a browser tab, the device can clear unsynced sales during a long outage. " +
        "Installing Golden Squirrel keeps them safe.",
      facts,
    };
  }

  return {
    level: "protected",
    urgent: false,
    headline: "Offline sales are protected on this device",
    detail: "The browser has been told not to clear this app's storage.",
    facts,
  };
}

/**
 * Gather the facts and classify them.
 *
 * Never throws: this runs at boot and on a screen that must not be breakable by
 * a storage API having a bad day.
 */
export async function readDurability(): Promise<Durability> {
  let facts: DurabilityFacts = {
    supported: false,
    persisted: false,
    nearFull: false,
    usageRatio: 0,
    queuedSales: 0,
    deadLettered: 0,
  };

  try {
    const [persist, health, queued, dead] = await Promise.all([
      ensurePersistentStorage(),
      getStorageHealth(),
      getQueuedCount().catch(() => 0),
      getDeadLetterTransactions()
        .then((rows) => rows.length)
        .catch(() => 0),
    ]);

    facts = {
      supported: persist.supported && health.supported,
      persisted: persist.persisted,
      nearFull: health.nearFull,
      usageRatio: health.ratio,
      queuedSales: queued,
      deadLettered: dead,
    };
  } catch {
    // Fall through with the zeroed facts, which classify as "unknown" — the
    // honest answer when the check itself failed.
  }

  return classifyDurability(facts);
}

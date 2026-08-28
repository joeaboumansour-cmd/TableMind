/**
 * Delivery of activity events: post them, buffer them when that fails, drain
 * the buffer when the network comes back.
 *
 * Two rules shape everything here:
 *
 *  1. This must never compete with money. The sync engine calls
 *     `setSyncBusy()` around its run and the drain loop stands down for the
 *     duration, so log traffic cannot slow a queued sale reaching the server.
 *     (This module deliberately does not import syncEngine — the engine
 *     imports the logger, and a cycle back through here would be fragile.)
 *
 *  2. Logs are expendable. A batch the server refuses is DROPPED, not
 *     dead-lettered. That is the opposite of what queued sales do, and it is
 *     correct: an un-sendable log accumulating forever would eventually cost
 *     the till its disk.
 */

import { connectivity } from "@/lib/connectivity";
import { buildAuthHeaders } from "@/lib/auth/requestHeaders";
import {
  bufferActivityEvents,
  getBufferedActivityEvents,
  deleteBufferedActivityEvents,
} from "@/lib/db/localDB";
import { ACTIVITY_LIMITS, type ActivityEvent } from "./types";

/** Bodies at or above this cannot use `keepalive` (spec limit is 64KB). */
const KEEPALIVE_BODY_LIMIT = 60_000;

/** How often the buffer is checked while online, in ms. */
const DRAIN_INTERVAL_MS = 60_000;

type SendResult =
  /** The server took them. Delete locally. */
  | "accepted"
  /** The server refused them and always will. Delete locally; do not retry. */
  | "rejected"
  /** Network, server fault, or a client-auth blip. Keep them and try later. */
  | "deferred";

let syncBusy = false;
let draining = false;
let drainTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeConnectivity: (() => void) | null = null;

/**
 * Called by the sync engine around `runSync()`.
 *
 * The engine owns the money path; while it is working, log delivery yields.
 */
export function setSyncBusy(busy: boolean): void {
  syncBusy = busy;
  // Coming out of a sync is a good moment to catch up, and the network has
  // just been proven to work.
  if (!busy) void drainActivityBuffer();
}

/**
 * How the server's answer maps onto keep-or-drop.
 *
 * Mirrors `isTransientSyncFailure()` in the sync engine, including its
 * treatment of 401/403: those describe the client's auth state, not the
 * payload, and they resolve when someone signs back in.
 */
function classify(response: Response | null): SendResult {
  if (!response) return "deferred"; // fetch threw — offline, DNS, aborted
  if (response.ok) return "accepted";
  if (response.status >= 500) return "deferred";
  if (response.status === 408 || response.status === 429) return "deferred";
  if (response.status === 401 || response.status === 403) return "deferred";
  return "rejected"; // 400, 413, 422 — this payload will never be accepted
}

async function postEvents(events: ActivityEvent[]): Promise<SendResult> {
  const body = JSON.stringify({ events });

  // Guard the body cap here as well as at the server, so an oversized batch is
  // split by the caller rather than round-tripping to a 413.
  if (body.length > ACTIVITY_LIMITS.maxRequestBytes) return "rejected";

  try {
    const response = await fetch("/api/activity", {
      method: "POST",
      headers: buildAuthHeaders(),
      body,
      // Survives the tab closing, which is exactly when the last few events of
      // a session would otherwise be lost.
      keepalive: body.length < KEEPALIVE_BODY_LIMIT,
    });
    return classify(response);
  } catch {
    return classify(null);
  }
}

/**
 * Ship a batch, or buffer it.
 *
 * Note it always ATTEMPTS the request rather than branching on
 * `connectivity.isOffline` first — per the offline-write skill, a check cannot
 * tell you the request will succeed, and the failure path is the same either
 * way. The one exception is a known-offline device, where skipping the fetch
 * avoids a pointless timeout on every flush tick.
 */
export async function deliverActivityBatch(events: ActivityEvent[]): Promise<void> {
  if (events.length === 0) return;

  if (connectivity.isOffline) {
    await bufferEvents(events);
    return;
  }

  const result = await postEvents(events);
  if (result === "deferred") {
    await bufferEvents(events);
  }
  // "accepted" — done. "rejected" — the server will never take these; dropping
  // them is the intended behaviour for a log.
}

async function bufferEvents(events: ActivityEvent[]): Promise<void> {
  await bufferActivityEvents(
    events.map((event) => ({ occurred_at: event.occurred_at, event }))
  );
}

/**
 * Drain the offline buffer, oldest first.
 *
 * Buffered rows are deleted only after the server has answered — accepted or
 * definitively rejected. A deferred batch is left exactly where it is, so an
 * outage that outlasts the process loses nothing.
 */
export async function drainActivityBuffer(): Promise<void> {
  if (draining || syncBusy || connectivity.isOffline) return;

  draining = true;
  try {
    // Bounded so a very large buffer cannot monopolise the tab; the interval
    // picks up where this left off.
    for (let pass = 0; pass < 20; pass++) {
      if (syncBusy || connectivity.isOffline) break;

      const rows = await getBufferedActivityEvents(ACTIVITY_LIMITS.maxEventsPerRequest);
      if (rows.length === 0) break;

      const result = await postEvents(rows.map((r) => r.event as ActivityEvent));
      if (result === "deferred") break;

      // Both "accepted" and "rejected" mean these rows are finished with.
      await deleteBufferedActivityEvents(
        rows.map((r) => r.seq).filter((seq): seq is number => typeof seq === "number")
      );
    }
  } catch (e) {
    console.warn("[Activity] Buffer drain failed:", e);
  } finally {
    draining = false;
  }
}

/** Start the drain loop. Idempotent. */
export function startActivityFlusher(): void {
  if (typeof window === "undefined") return;

  if (!unsubscribeConnectivity) {
    unsubscribeConnectivity = connectivity.subscribe((status) => {
      if (status === "online") void drainActivityBuffer();
    });
  }

  if (drainTimer === null) {
    drainTimer = setInterval(() => void drainActivityBuffer(), DRAIN_INTERVAL_MS);
  }
}

export function stopActivityFlusher(): void {
  if (unsubscribeConnectivity) {
    unsubscribeConnectivity();
    unsubscribeConnectivity = null;
  }
  if (drainTimer !== null) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}

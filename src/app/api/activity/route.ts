import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  ACTIVITY_LIMITS,
  ACTIVITY_RETENTION_DAYS,
  categoryForAction,
  isKnownAction,
  type ActivityAction,
} from "@/lib/activity/types";

/**
 * Activity ingest.
 *
 * ⚠️ Tenancy comes from the unsigned `x-auth-data` header, which is the known
 * P0-1 vulnerability. The api-route skill says to move off it, and this route
 * would — except the store side has no signed token to move TO; building one is
 * a separate project. What makes it tolerable here specifically:
 *
 *   - the endpoint is WRITE-ONLY for stores. Nothing a store can call reads
 *     this table back, so a forged header cannot exfiltrate anyone's trail.
 *   - the worst it buys an attacker is junk rows in one store's log, and the
 *     caps below bound how many.
 *   - store_id is taken from the header for EVERY row and the body's own
 *     store_id, if any, is ignored outright.
 *
 * When store sessions become signed, this route changes in one place.
 */

/** How long a serverless instance waits between partition-maintenance runs. */
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** Coarse per-store flood guard. Roughly 2,000 events a minute. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_EVENTS = 2_000;

let lastMaintenanceAt = 0;

/**
 * In-memory rate state.
 *
 * Per serverless instance, so this is a flood guard rather than a real quota —
 * it exists to stop one runaway device, not a determined attacker. Bounded so
 * the map itself cannot grow without limit.
 */
const rateState = new Map<string, { count: number; windowStart: number }>();

function overRateLimit(storeId: string, events: number): boolean {
  const now = Date.now();
  const entry = rateState.get(storeId);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    if (rateState.size > 500) rateState.clear();
    rateState.set(storeId, { count: events, windowStart: now });
    return false;
  }

  entry.count += events;
  return entry.count > RATE_MAX_EVENTS;
}

function str(value: unknown, max: number = ACTIVITY_LIMITS.maxStringLength): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** A UUID, or null. Used for user_id, which must never be a free-text value. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

interface PreparedRow {
  store_id: string;
  user_id: string | null;
  user_name: string | null;
  session_id: string;
  device_id: string | null;
  category: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  route: string | null;
  is_offline: boolean;
  client_event_id: string;
  occurred_at: string;
}

/**
 * Validate one event and normalise it into a row, or reject it.
 *
 * Returns null for anything malformed. A rejected event is dropped silently —
 * a log that argues with its client is worse than a log with a gap.
 */
function prepare(raw: unknown, storeId: string, now: number, floor: number): PreparedRow | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;

  // The action is the only field with a closed vocabulary, and it is what the
  // admin UI filters on. Anything unrecognised is not a shape we can render.
  if (!isKnownAction(e.action)) return null;
  const action = e.action as ActivityAction;

  const sessionId = str(e.session_id, 64);
  const clientEventId = str(e.client_event_id, 64);
  if (!sessionId || !clientEventId) return null;

  // --- occurred_at: clamped, never trusted -----------------------------------
  // A device clock can be wrong in both directions, and there is no DEFAULT
  // partition to catch a stray timestamp — an out-of-range row would fail the
  // whole insert, not just itself.
  const parsed = typeof e.occurred_at === "string" ? Date.parse(e.occurred_at) : NaN;
  if (!Number.isFinite(parsed)) return null;
  // Older than the retained window: it has no partition and would be pruned
  // within the hour regardless. Drop it.
  if (parsed < floor) return null;
  // Ahead of the server: clock skew. Pin it to now rather than discarding a
  // real event.
  const occurredAt = new Date(Math.min(parsed, now)).toISOString();

  let details: Record<string, unknown> = {};
  if (e.details && typeof e.details === "object" && !Array.isArray(e.details)) {
    const serialised = JSON.stringify(e.details);
    details =
      serialised && serialised.length <= ACTIVITY_LIMITS.maxDetailsBytes
        ? (e.details as Record<string, unknown>)
        : { _truncated: true };
  }

  return {
    // Always the authenticated store. The body does not get a say.
    store_id: storeId,
    user_id: uuidOrNull(e.user_id),
    user_name: str(e.user_name, 120),
    session_id: sessionId,
    device_id: str(e.device_id, 64),
    category: categoryForAction(action),
    action,
    target: str(e.target),
    details,
    route: str(e.route, 200),
    is_offline: e.is_offline === true,
    client_event_id: clientEventId,
    occurred_at: occurredAt,
  };
}

function isMissingPartition(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "23514" ||
    (typeof error.message === "string" && error.message.includes("no partition of relation"))
  );
}

export async function POST(request: Request) {
  try {
    const authData = request.headers.get("x-auth-data");
    if (!authData) {
      return NextResponse.json({ error: "Unauthorized - No auth data provided" }, { status: 401 });
    }

    let storeId: string | undefined;
    try {
      storeId = JSON.parse(authData)?.store_id;
    } catch {
      return NextResponse.json({ error: "Unauthorized - Invalid auth data format" }, { status: 401 });
    }
    if (!storeId || !UUID_RE.test(storeId)) {
      return NextResponse.json({ error: "Unauthorized - No store_id in auth data" }, { status: 401 });
    }

    const rawBody = await request.text();
    if (rawBody.length > ACTIVITY_LIMITS.maxRequestBytes) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: { events?: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const events = body?.events;
    if (!Array.isArray(events)) {
      return NextResponse.json({ error: "events must be an array" }, { status: 400 });
    }
    if (events.length === 0) {
      return NextResponse.json({ accepted: 0, dropped: 0 });
    }
    if (events.length > ACTIVITY_LIMITS.maxEventsPerRequest) {
      return NextResponse.json(
        { error: `At most ${ACTIVITY_LIMITS.maxEventsPerRequest} events per request` },
        { status: 400 }
      );
    }

    if (overRateLimit(storeId, events.length)) {
      // 429 is classified as transient by the client, so the batch is kept and
      // retried rather than thrown away.
      return NextResponse.json({ error: "Too many events" }, { status: 429 });
    }

    const now = Date.now();
    // Start of the oldest retained UTC day — the earliest timestamp that has a
    // partition to land in.
    const floor = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate() - (ACTIVITY_RETENTION_DAYS - 1)
    );

    const rows: PreparedRow[] = [];
    for (const raw of events) {
      const row = prepare(raw, storeId, now, floor);
      if (row) rows.push(row);
    }

    const dropped = events.length - rows.length;
    if (rows.length === 0) {
      return NextResponse.json({ accepted: 0, dropped });
    }

    const supabase = await createServiceRoleClient();

    let { error } = await supabase.from("activity_logs").insert(rows);

    // The one failure worth recovering from: maintenance has not run recently
    // enough and today's partition does not exist yet. Create it and try once
    // more, rather than losing a batch to a scheduling gap.
    if (isMissingPartition(error)) {
      console.warn("[Activity] Missing partition — running maintenance and retrying");
      await supabase.rpc("maintain_activity_log_partitions", {
        p_retention_days: ACTIVITY_RETENTION_DAYS,
      });
      lastMaintenanceAt = Date.now();
      ({ error } = await supabase.from("activity_logs").insert(rows));
    }

    if (error) {
      console.error("[Activity] Insert failed:", error.message);
      return NextResponse.json({ error: "Failed to record activity" }, { status: 500 });
    }

    const response = NextResponse.json({ accepted: rows.length, dropped });

    // Opportunistic retention. Ingest traffic is constant, so this runs
    // reliably without any cron, and it is fired AFTER the response is built so
    // it never sits on the request path. maintain_activity_log_partitions() is
    // idempotent and safe to call concurrently.
    if (now - lastMaintenanceAt > MAINTENANCE_INTERVAL_MS) {
      lastMaintenanceAt = now;
      void supabase
        .rpc("maintain_activity_log_partitions", { p_retention_days: ACTIVITY_RETENTION_DAYS })
        .then(({ error: maintenanceError }) => {
          if (maintenanceError) {
            console.error("[Activity] Partition maintenance failed:", maintenanceError.message);
          }
        });
    }

    return response;
  } catch (error: unknown) {
    console.error("[Activity] Ingest error:", error);
    return NextResponse.json({ error: "Failed to record activity" }, { status: 500 });
  }
}

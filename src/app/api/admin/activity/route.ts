import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/adminSession";
import { isKnownAction, isKnownCategory } from "@/lib/activity/types";

/**
 * Read the activity trail. Admin only.
 *
 * Unlike its neighbours under /api/admin, this route is actually authenticated:
 * it serves the behaviour of every store in the fleet, so it is gated on a
 * signed session cookie before anything else happens. See
 * src/lib/auth/adminSession.ts.
 */

// A day of one store's trail is tens of thousands of rows, so the page needs to
// be big enough to scroll through — but the rows carry a JSONB blob each, so
// there is still a ceiling.
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

/** Export cap. Enough to be useful, small enough not to stream a gigabyte. */
const CSV_MAX_ROWS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLUMNS =
  "id, store_id, user_id, user_name, session_id, device_id, category, action, target, details, route, is_offline, occurred_at, received_at";

interface ActivityRow {
  id: number;
  store_id: string;
  user_id: string | null;
  user_name: string | null;
  session_id: string;
  device_id: string | null;
  category: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  route: string | null;
  is_offline: boolean;
  occurred_at: string;
  received_at: string;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: ActivityRow[]): string {
  const header = [
    "occurred_at",
    "received_at",
    "store_id",
    "user_name",
    "user_id",
    "category",
    "action",
    "target",
    "route",
    "is_offline",
    "session_id",
    "device_id",
    "details",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.occurred_at,
        r.received_at,
        r.store_id,
        r.user_name,
        r.user_id,
        r.category,
        r.action,
        r.target,
        r.route,
        r.is_offline,
        r.session_id,
        r.device_id,
        r.details,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export async function GET(request: Request) {
  try {
    const session = await requireAdmin(request);
    if (session instanceof NextResponse) return session;

    const url = new URL(request.url);
    const params = url.searchParams;
    const format = params.get("format");
    const isCsv = format === "csv";

    // --- filters -------------------------------------------------------------
    const storeId = params.get("store_id");
    if (storeId && !UUID_RE.test(storeId)) {
      return NextResponse.json({ error: "Invalid store_id" }, { status: 400 });
    }

    // "owner" is a real selection, not a missing filter: an owner's rows carry
    // a NULL user_id by design, so it has to be asked for explicitly.
    const userId = params.get("user_id");
    if (userId && userId !== "owner" && !UUID_RE.test(userId)) {
      return NextResponse.json({ error: "Invalid user_id" }, { status: 400 });
    }

    const from = params.get("from");
    const to = params.get("to");
    if (from && Number.isNaN(Date.parse(from))) {
      return NextResponse.json({ error: "Invalid from" }, { status: 400 });
    }
    if (to && Number.isNaN(Date.parse(to))) {
      return NextResponse.json({ error: "Invalid to" }, { status: 400 });
    }

    const categories = (params.get("category") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (categories.some((c) => !isKnownCategory(c))) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 });
    }

    const action = params.get("action");
    if (action && !isKnownAction(action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const q = (params.get("q") ?? "").trim();

    // --- pagination ----------------------------------------------------------
    const rawLimit = params.get("limit");
    let limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
    }
    limit = Math.min(limit, MAX_PAGE_SIZE);

    // Keyset on (occurred_at DESC, id DESC), same shape as /api/transactions.
    // Offset paging would skip or repeat rows here, because events keep
    // arriving while the admin scrolls.
    const cursor = params.get("cursor");
    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const sep = cursor.lastIndexOf("|");
      cursorAt = sep === -1 ? null : cursor.slice(0, sep);
      cursorId = sep === -1 ? null : cursor.slice(sep + 1);
      if (!cursorAt || !cursorId || Number.isNaN(Date.parse(cursorAt))) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    // --- query ---------------------------------------------------------------
    const supabase = await createServiceRoleClient();

    let query = supabase
      .from("activity_logs")
      .select(SELECT_COLUMNS)
      .order("occurred_at", { ascending: false })
      // id is the tiebreaker — without a unique second sort key, rows sharing
      // an occurred_at can be skipped or duplicated across a page boundary.
      .order("id", { ascending: false });

    if (storeId) query = query.eq("store_id", storeId);
    if (userId === "owner") query = query.is("user_id", null);
    else if (userId) query = query.eq("user_id", userId);
    if (from) query = query.gte("occurred_at", from);
    if (to) query = query.lte("occurred_at", to);
    if (categories.length === 1) query = query.eq("category", categories[0]);
    else if (categories.length > 1) query = query.in("category", categories);
    if (action) query = query.eq("action", action);

    if (q) {
      // Escaped so a comma or a paren in the search box cannot break out of the
      // PostgREST filter grammar.
      const safe = q.replace(/[,()\\]/g, " ");
      query = query.or(`target.ilike.%${safe}%,action.ilike.%${safe}%,user_name.ilike.%${safe}%`);
    }

    if (cursorAt && cursorId) {
      query = query.or(
        `occurred_at.lt.${cursorAt},and(occurred_at.eq.${cursorAt},id.lt.${cursorId})`
      );
    }

    const pageSize = isCsv ? CSV_MAX_ROWS : limit + 1;
    const { data, error } = await query.limit(pageSize);

    if (error) {
      console.error("[AdminActivity] Query failed:", error.message);
      return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as ActivityRow[];

    if (isCsv) {
      return new NextResponse(toCsv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="activity-${new Date()
            .toISOString()
            .slice(0, 10)}.csv"`,
        },
      });
    }

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const last = events[events.length - 1];
    const nextCursor = hasMore && last ? `${last.occurred_at}|${last.id}` : null;

    return NextResponse.json({ events, nextCursor, hasMore });
  } catch (error: unknown) {
    console.error("[AdminActivity] Error:", error);
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
  }
}

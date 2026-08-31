import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { canAccessSection } from "@/lib/auth/apiCaller";
import { callerAndRead } from "@/lib/auth/apiRoute";
import { productCostInLL } from "@/lib/analytics/profit";

interface AnalyticsResponse {
  summary: {
    totalRevenue: number;
    totalProfit: number;
    totalTransactions: number;
    averageTransactionValue: number;
    totalItemsSold: number;
    profitMargin: number;
  };
  topProductsByRevenue: Array<{
    product_name: string;
    totalQuantity: number;
    totalRevenue: number;
  }>;
  topProductsByQuantity: Array<{
    product_name: string;
    totalQuantity: number;
    totalRevenue: number;
  }>;
  hourlySales: Array<{
    hour: number;
    revenue: number;
    transactions: number;
  }>;
  dayOfWeekSales: Array<{
    day: string;
    revenue: number;
    transactions: number;
  }>;
}

function getCutoffDate(filter: string): Date | null {
  const now = new Date();
  switch (filter) {
    case "hour":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90days":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Where the shop is, used when the client does not say. This app serves
 * Lebanese stores, so falling back to Beirut is right far more often than
 * falling back to the server's own zone (UTC on Vercel) ever was.
 */
const STORE_FALLBACK_TZ = "Asia/Beirut";

/** The client's IANA zone if it is one this runtime knows, else the store's. */
function resolveTimeZone(raw: string | null): string {
  if (!raw) return STORE_FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return STORE_FALLBACK_TZ;
  }
}

/**
 * Wall-clock hour and weekday of an instant, in `timeZone`.
 *
 * Intl rather than an offset in minutes: Beirut runs EET/EEST, so a 90-day
 * window crosses a DST change and a single fixed offset would misplace every
 * transaction on one side of it. Intl resolves the offset per instant.
 */
function makeLocalClock(timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    weekday: "long",
  });
  return (date: Date) => {
    let hour = 0;
    let weekday = "";
    for (const part of fmt.formatToParts(date)) {
      // Some ICU builds render midnight as "24" under hour12:false.
      if (part.type === "hour") hour = Number.parseInt(part.value, 10) % 24;
      else if (part.type === "weekday") weekday = part.value;
    }
    return { hour, dayOfWeek: DAY_NAMES.indexOf(weekday) };
  };
}

export async function GET(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // Query params first: parsing a URL costs no I/O, so everything the report
    // needs is known before a single round trip is spent.
    const url = new URL(request.url);
    const dateFilter = url.searchParams.get("dateFilter") || "all";

    // `from` is the window start already resolved in the STORE's timezone by
    // the client. Prefer it over deriving the boundary here.
    //
    // Only "today" is calendar-anchored; every other filter is a rolling
    // `now − duration` and so is timezone-independent. Computing "today" with
    // getCutoffDate() means midnight in the SERVER's zone — UTC on Vercel —
    // which for a Beirut store starts the day three hours late and made the
    // profit figure disagree with the sales listed next to it. getCutoffDate
    // remains as the fallback for older clients and direct calls.
    // Same reasoning as `from`: the device knows which clock the shop runs on.
    const timeZone = resolveTimeZone(url.searchParams.get("tz"));
    const localClock = makeLocalClock(timeZone);

    const fromParam = url.searchParams.get("from");
    let cutoff: Date | null = getCutoffDate(dateFilter);
    if (fromParam) {
      const parsedFrom = new Date(fromParam);
      if (!Number.isNaN(parsedFrom.getTime())) {
        cutoff = parsedFrom;
      } else {
        return NextResponse.json({ error: "Invalid `from` timestamp" }, { status: 400 });
      }
    }

    // ── The report is aggregated in Postgres ────────────────────────────────
    //
    // This used to `select` every transaction in the window WITH every nested
    // line item and add it all up in JavaScript, with no `.limit()`. Two
    // separate problems, and the second is the serious one:
    //
    //   * SLOW — 700-2,900 ms measured on a store with FORTY sales, to return
    //     3 KB of report. It scaled with the store's whole history.
    //   * WRONG — PostgREST silently caps an unbounded select at 1,000 rows.
    //     Any store with more than 1,000 sales in the window was shown revenue
    //     and profit computed from an arbitrary 1,000 of them, with nothing on
    //     screen to say the number was partial.
    //
    // Same rule the cash page already follows (CLAUDE.md §11a): aggregate in
    // Postgres, never by summing a select.
    //
    // The USD→LL conversion is deliberately NOT in the SQL. The rate has one
    // definition, in src/lib/utils/format.ts, and `usd_cost_lines` comes back
    // as raw (cost_price, quantity) pairs so productCostInLL() converts each
    // one exactly as it did before — converting a pre-summed USD total would
    // round once instead of per product and quietly move the figure.
    // ── Auth and the report go out TOGETHER, not one after the other ────────
    //
    // This used to resolve the caller, then run the aggregate — two serial
    // round trips for a screen the shop owner opens daily. The report is
    // scoped to the `store_id` the caller is CLAIMING, so a failed auth
    // discards a read of their own store and nothing is returned before the
    // caller is confirmed. Same pattern GET /api/cash-shifts already uses.
    //
    // The section check still gates the RESPONSE: a cashier with
    // transactions:false gets 403 and never sees the numbers, exactly as
    // before. Hiding the History link was never the guard.
    const outcome = await callerAndRead(request, (client, storeId) =>
      client.rpc("get_transaction_analytics", {
        p_store_id: storeId,
        p_from: cutoff ? cutoff.toISOString() : null,
        p_tz: timeZone,
      })
    );

    if ("error" in outcome) return outcome.error;

    const { caller, storeId: store_id, result: rpc } = outcome;
    if (!canAccessSection(caller, "transactions")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = await createServiceRoleClient();

    if (!rpc.error && rpc.data) {
      return NextResponse.json(buildFromAggregate(rpc.data as AggregateRow));
    }

    if (rpc.error && !isMissingFunction(rpc.error)) {
      console.error("Analytics RPC error:", rpc.error);
      return NextResponse.json({ error: rpc.error.message }, { status: 500 });
    }

    // ── Fallback: migration 037 has not been applied to this database ───────
    //
    // Kept so the code and the migration can be deployed in either order. It
    // is the old JavaScript aggregation, with the two defects that made it
    // dangerous fixed: it PAGES through the window instead of taking whatever
    // PostgREST felt like returning, and it chunks the product lookup instead
    // of building a URL out of every product id in the range.
    console.warn(
      "[Analytics] get_transaction_analytics not available (migration 037 not applied?) — aggregating in JS"
    );
    return NextResponse.json(
      await computeAnalyticsInJs(supabase, store_id, cutoff, localClock)
    );
  } catch (error: any) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics", details: error?.message },
      { status: 500 }
    );
  }
}

// =============================================================================
// Aggregate path
// =============================================================================

interface AggregateRow {
  total_revenue: number | string;
  total_transactions: number | string;
  total_items_sold: number | string;
  cost_ll: number | string;
  usd_cost_lines: Array<{ cost_price: number | string; quantity: number | string }>;
  top_by_revenue: Array<{ product_name: string; totalQuantity: number; totalRevenue: number }>;
  top_by_quantity: Array<{ product_name: string; totalQuantity: number; totalRevenue: number }>;
  hourly: Array<{ hour: number; revenue: number | string; transactions: number | string }>;
  weekday: Array<{ dow: number; revenue: number | string; transactions: number | string }>;
}

/** Postgres returns NUMERIC as a string to preserve precision. */
function num(value: number | string | null | undefined): number {
  return Number(value) || 0;
}

function buildFromAggregate(row: AggregateRow): AnalyticsResponse {
  const totalRevenue = num(row.total_revenue);
  const totalTransactions = num(row.total_transactions);
  const totalItemsSold = num(row.total_items_sold);

  // productCostInLL is the shared helper — same function the offline History
  // screen uses, so the two can never disagree about what a USD cost is worth.
  let totalCost = num(row.cost_ll);
  for (const line of row.usd_cost_lines || []) {
    const costLl = productCostInLL({ cost_price: num(line.cost_price), currency: "USD" }) ?? 0;
    totalCost += costLl * num(line.quantity);
  }

  const totalProfit = totalRevenue - totalCost;

  const hourById = new Map((row.hourly || []).map((h) => [Number(h.hour), h]));
  const dowById = new Map((row.weekday || []).map((d) => [Number(d.dow), d]));

  const normaliseTop = (
    rows: Array<{ product_name: string; totalQuantity: number; totalRevenue: number }>
  ) =>
    (rows || []).map((r) => ({
      product_name: r.product_name,
      totalQuantity: num(r.totalQuantity),
      totalRevenue: num(r.totalRevenue),
    }));

  return {
    summary: {
      totalRevenue,
      totalProfit,
      totalTransactions,
      averageTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
      totalItemsSold,
      profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    },
    topProductsByRevenue: normaliseTop(row.top_by_revenue),
    topProductsByQuantity: normaliseTop(row.top_by_quantity),
    hourlySales: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      revenue: num(hourById.get(hour)?.revenue),
      transactions: num(hourById.get(hour)?.transactions),
    })),
    dayOfWeekSales: DAY_NAMES.map((day, index) => ({
      day,
      revenue: num(dowById.get(index)?.revenue),
      transactions: num(dowById.get(index)?.transactions),
    })),
  };
}

/** PostgREST's answer when the RPC does not exist in this database. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(error.message || "")
  );
}

// =============================================================================
// Fallback path — only reached when migration 037 is not applied
// =============================================================================

/** PostgREST's own hard cap per request. */
const PAGE_SIZE = 1000;
/**
 * Ceiling on the fallback's paging. 200,000 transactions is far past anything
 * this app's retention policy allows, so hitting it means something is wrong;
 * stopping is better than looping forever inside a serverless invocation.
 */
const MAX_PAGES = 200;
/** Product ids per `.in()` — a bigger list builds a URL that 414s. */
const ID_CHUNK = 200;

async function computeAnalyticsInJs(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  store_id: string,
  cutoff: Date | null,
  localClock: (date: Date) => { hour: number; dayOfWeek: number }
): Promise<AnalyticsResponse> {
  type Row = {
    id: string;
    total_amount: number;
    subtotal: number;
    created_at: string;
    transaction_items: Array<{
      product_name: string;
      quantity: number;
      unit_price: number;
      total_price: number;
      currency: string;
      product_id: string | null;
    }> | null;
  };

  const txns: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = supabase
      .from("transactions")
      .select(
        `
        id,
        total_amount,
        subtotal,
        created_at,
        transaction_items (
          product_name,
          quantity,
          unit_price,
          total_price,
          currency,
          product_id
        )
      `
      )
      .eq("store_id", store_id)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (cutoff) {
      query = query.gte("created_at", cutoff.toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data || []) as unknown as Row[];
    txns.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // Collect unique product IDs to fetch cost prices
  const productIds = new Set<string>();
  txns.forEach((t) => {
    t.transaction_items?.forEach((item) => {
      if (item.product_id) productIds.add(item.product_id);
    });
  });

  // `cost_price` is stored in the product's own `currency` (USD or LL) while
  // transaction amounts are ALWAYS LL, so a USD cost must be converted before
  // it is subtracted from LL revenue — otherwise the tiny USD number is dwarfed
  // and profit erroneously ≈ revenue. productCostInLL is shared with the
  // offline path so the two cannot drift.
  const costPriceMap: Record<string, number> = {};
  const allIds = Array.from(productIds);
  for (let i = 0; i < allIds.length; i += ID_CHUNK) {
    const { data: products } = await supabase
      .from("products")
      .select("id, cost_price, currency")
      .eq("store_id", store_id)
      .in("id", allIds.slice(i, i + ID_CHUNK));

    (products || []).forEach((p) => {
      costPriceMap[p.id] = productCostInLL(p) ?? 0;
    });
  }

  let totalRevenue = 0;
  let totalItemsSold = 0;
  let totalCost = 0;
  const productStats: Record<string, { quantity: number; revenue: number }> = {};
  const hourlyStats: Record<number, { revenue: number; transactions: number }> = {};
  const dayOfWeekStats: Record<number, { revenue: number; transactions: number }> = {};

  txns.forEach((t) => {
    const revenue = Number(t.total_amount) || 0;
    totalRevenue += revenue;
    totalItemsSold += t.transaction_items?.length || 0;

    // NOT getHours()/getDay(): those are the SERVER's clock, so on Vercel an
    // 11am Beirut sale was filed under 8am and a sale just after midnight under
    // the previous day.
    const { hour, dayOfWeek } = localClock(new Date(t.created_at));

    if (!hourlyStats[hour]) hourlyStats[hour] = { revenue: 0, transactions: 0 };
    hourlyStats[hour].revenue += revenue;
    hourlyStats[hour].transactions += 1;

    // dayOfWeek is -1 only if Intl returned a weekday name DAY_NAMES does not
    // carry, which should not happen under the en-US locale — but silently
    // writing to index -1 would.
    if (dayOfWeek >= 0) {
      if (!dayOfWeekStats[dayOfWeek]) dayOfWeekStats[dayOfWeek] = { revenue: 0, transactions: 0 };
      dayOfWeekStats[dayOfWeek].revenue += revenue;
      dayOfWeekStats[dayOfWeek].transactions += 1;
    }

    t.transaction_items?.forEach((item) => {
      const cost = (item.product_id ? costPriceMap[item.product_id] : undefined) || item.unit_price || 0;
      totalCost += cost * item.quantity;

      const name = item.product_name;
      if (!productStats[name]) productStats[name] = { quantity: 0, revenue: 0 };
      productStats[name].quantity += item.quantity;
      productStats[name].revenue += Number(item.total_price) || 0;
    });
  });

  const totalTransactions = txns.length;
  const totalProfit = totalRevenue - totalCost;
  const ranked = Object.entries(productStats).map(([product_name, stats]) => ({
    product_name,
    totalQuantity: stats.quantity,
    totalRevenue: stats.revenue,
  }));

  return {
    summary: {
      totalRevenue,
      totalProfit,
      totalTransactions,
      averageTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
      totalItemsSold,
      profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    },
    topProductsByRevenue: [...ranked].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 10),
    topProductsByQuantity: [...ranked].sort((a, b) => b.totalQuantity - a.totalQuantity).slice(0, 10),
    hourlySales: Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      revenue: hourlyStats[i]?.revenue || 0,
      transactions: hourlyStats[i]?.transactions || 0,
    })),
    dayOfWeekSales: DAY_NAMES.map((day, index) => ({
      day,
      revenue: dayOfWeekStats[index]?.revenue || 0,
      transactions: dayOfWeekStats[index]?.transactions || 0,
    })),
  };
}

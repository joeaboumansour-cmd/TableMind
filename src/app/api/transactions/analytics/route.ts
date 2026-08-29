import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { resolveCaller, readAuthHeader, canAccessSection } from "@/lib/auth/apiCaller";
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

    const supabase = await createServiceRoleClient();

    const authData = request.headers.get("x-auth-data");
    if (!authData) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let store_id: string;
    try {
      const parsed = JSON.parse(authData);
      store_id = parsed.store_id;
    } catch {
      return NextResponse.json({ error: "Invalid auth data" }, { status: 401 });
    }

    // Hiding the History link is not a guard — enforce the section here too.
    // A cashier with transactions:false who knows this URL used to get every
    // sale in the store, and the analytics route used to hand them the profit.
    const caller = await resolveCaller(supabase, store_id, readAuthHeader(request).userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canAccessSection(caller, "transactions")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get date filter from query params
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
    const localClock = makeLocalClock(resolveTimeZone(url.searchParams.get("tz")));

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

    // Fetch transactions with items
    let query = supabase
      .from("transactions")
      .select(`
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
      `)
      .eq("store_id", store_id)
      .order("created_at", { ascending: false });

    if (cutoff) {
      query = query.gte("created_at", cutoff.toISOString());
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error("Analytics query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const txns = transactions || [];

    // Calculate summary metrics
    let totalRevenue = 0;
    let totalItemsSold = 0;
    const productStats: Record<string, { quantity: number; revenue: number }> = {};

    // Time-based analytics
    const hourlyStats: Record<number, { revenue: number; transactions: number }> = {};
    const dayOfWeekStats: Record<number, { revenue: number; transactions: number }> = {};

    // Collect unique product IDs to fetch cost prices
    const productIds = new Set<string>();
    txns.forEach((t) => {
      t.transaction_items?.forEach((item) => {
        if (item.product_id) productIds.add(item.product_id);
      });
    });

    // Fetch current cost prices for products.
    // NOTE: `cost_price` is stored in the product's own `currency` (USD or LL).
    // Transaction amounts (total_amount / unit_price) are ALWAYS stored in LL,
    // so a USD-denominated cost_price must be converted to LL before it is
    // subtracted from LL revenue — otherwise the tiny USD cost is dwarfed by
    // the large LL revenue and profit erroneously ≈ revenue.
    let costPriceMap: Record<string, number> = {};
    if (productIds.size > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("id, cost_price, currency")
        .eq("store_id", store_id)
        .in("id", Array.from(productIds));

      if (products) {
        products.forEach((p) => {
          // Shared with the offline path in @/lib/analytics/profit so the two
          // cannot drift — see that module's header.
          costPriceMap[p.id] = productCostInLL(p) ?? 0;
        });
      }
    }

    let totalCost = 0;

    txns.forEach((t) => {
      const revenue = Number(t.total_amount) || 0;
      totalRevenue += revenue;
      totalItemsSold += t.transaction_items?.length || 0;

      // NOT getHours()/getDay(): those are the SERVER's clock, so on Vercel
      // an 11am Beirut sale was filed under 8am and a sale just after midnight
      // under the previous day.
      const { hour, dayOfWeek } = localClock(new Date(t.created_at));

      // Update hourly stats
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { revenue: 0, transactions: 0 };
      }
      hourlyStats[hour].revenue += revenue;
      hourlyStats[hour].transactions += 1;

      // Update day of week stats. dayOfWeek is -1 only if Intl returned a
      // weekday name DAY_NAMES does not carry, which should not happen under
      // the en-US locale above -- but silently writing to index -1 would.
      if (dayOfWeek >= 0) {
        if (!dayOfWeekStats[dayOfWeek]) {
          dayOfWeekStats[dayOfWeek] = { revenue: 0, transactions: 0 };
        }
        dayOfWeekStats[dayOfWeek].revenue += revenue;
        dayOfWeekStats[dayOfWeek].transactions += 1;
      }

      // Calculate cost of items
      t.transaction_items?.forEach((item) => {
        const cost = costPriceMap[item.product_id] || item.unit_price || 0;
        totalCost += cost * item.quantity;

        // Track product stats
        const name = item.product_name;
        if (!productStats[name]) {
          productStats[name] = { quantity: 0, revenue: 0 };
        }
        productStats[name].quantity += item.quantity;
        productStats[name].revenue += Number(item.total_price) || 0;
      });
    });

    const totalTransactions = txns.length;
    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const averageTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Top 10 products by revenue
    const topProductsByRevenue = Object.entries(productStats)
      .map(([product_name, stats]) => ({
        product_name,
        totalQuantity: stats.quantity,
        totalRevenue: stats.revenue,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    // Top 10 products by quantity
    const topProductsByQuantity = Object.entries(productStats)
      .map(([product_name, stats]) => ({
        product_name,
        totalQuantity: stats.quantity,
        totalRevenue: stats.revenue,
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10);

    // Hourly sales data (all 24 hours)
    const hourlySales = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      revenue: hourlyStats[i]?.revenue || 0,
      transactions: hourlyStats[i]?.transactions || 0,
    }));

    // Day of week sales data
    const dayOfWeekSales = DAY_NAMES.map((day, index) => ({
      day,
      revenue: dayOfWeekStats[index]?.revenue || 0,
      transactions: dayOfWeekStats[index]?.transactions || 0,
    }));

    const response: AnalyticsResponse = {
      summary: {
        totalRevenue,
        totalProfit,
        totalTransactions,
        averageTransactionValue,
        totalItemsSold,
        profitMargin,
      },
      topProductsByRevenue,
      topProductsByQuantity,
      hourlySales,
      dayOfWeekSales,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Analytics error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics", details: error?.message },
      { status: 500 }
    );
  }
}
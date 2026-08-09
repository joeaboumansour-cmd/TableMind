import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { convertUsdToLl } from "@/lib/utils/format";

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
  slowMovingProducts: Array<{
    product_name: string;
    totalQuantity: number;
    lastSold: string;
    daysSinceLastSale: number;
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

    // Get date filter from query params
    const url = new URL(request.url);
    const dateFilter = url.searchParams.get("dateFilter") || "all";
    const cutoff = getCutoffDate(dateFilter);

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
    const productLastSold: Record<string, string> = {};

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
          let cost = p.cost_price || 0;
          // Convert USD cost to LL using the same sell rate (90,000) the cart
          // store uses when turning a USD selling_price into LL. This keeps
          // cost and revenue in the same currency (LL).
          if (p.currency === 'USD') {
            cost = convertUsdToLl(cost);
          }
          costPriceMap[p.id] = cost;
        });
      }
    }

    let totalCost = 0;

    txns.forEach((t) => {
      const revenue = Number(t.total_amount) || 0;
      totalRevenue += revenue;
      totalItemsSold += t.transaction_items?.length || 0;

      const createdAt = new Date(t.created_at);
      const hour = createdAt.getHours();
      const dayOfWeek = createdAt.getDay();

      // Update hourly stats
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { revenue: 0, transactions: 0 };
      }
      hourlyStats[hour].revenue += revenue;
      hourlyStats[hour].transactions += 1;

      // Update day of week stats
      if (!dayOfWeekStats[dayOfWeek]) {
        dayOfWeekStats[dayOfWeek] = { revenue: 0, transactions: 0 };
      }
      dayOfWeekStats[dayOfWeek].revenue += revenue;
      dayOfWeekStats[dayOfWeek].transactions += 1;

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

        // Track last sold date
        if (!productLastSold[name] || new Date(t.created_at) > new Date(productLastSold[name])) {
          productLastSold[name] = t.created_at;
        }
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

    // Slow moving / dead stock (products with low or no sales)
    // Consider products with only 1 sale as slow moving
    const slowMovingProducts = Object.entries(productStats)
      .filter(([_, stats]) => stats.quantity <= 1)
      .map(([product_name, stats]) => {
        const lastSold = productLastSold[product_name] || "";
        const daysSinceLastSale = lastSold
          ? Math.floor((Date.now() - new Date(lastSold).getTime()) / (1000 * 60 * 60 * 24))
          : 999;
        return {
          product_name,
          totalQuantity: stats.quantity,
          lastSold,
          daysSinceLastSale,
        };
      })
      .sort((a, b) => b.daysSinceLastSale - a.daysSinceLastSale)
      .slice(0, 10);

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
      slowMovingProducts,
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
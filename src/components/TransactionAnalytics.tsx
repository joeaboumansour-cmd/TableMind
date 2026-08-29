"use client";

import { useState, useEffect, useCallback } from "react";
import { buildAuthHeaders } from "@/lib/auth/apiHeaders";
import { Button } from "@/components/ui/button";
import { HourlySalesChart } from "@/components/charts/HourlySalesChart";
import { DayOfWeekChart } from "@/components/charts/DayOfWeekChart";
import { RankedBarList } from "@/components/charts/RankedBarList";
import {
  formatLL,
  formatLLParts,
  formatPercent,
  formatUSD,
  // RETURN_RATE, matching the till and History. See transactions/page.tsx.
  convertLlToUsdForReturn,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { analyticsQuery } from "@/lib/dateFilter";

interface AnalyticsData {
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

interface TransactionAnalyticsProps {
  dateFilter: string;
  storeId: string;
}

/** Section wrapper — one heading style for the whole panel. */
function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div className="h-full rounded-3xl border border-white/10 bg-card p-4">{children}</div>
    </section>
  );
}

/** Headline figure tile. */
function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "primary" | "positive" | "negative";
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-extrabold leading-tight tnum",
          tone === "primary" && "text-primary",
          tone === "positive" && "text-emerald-400",
          tone === "negative" && "text-destructive"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground tnum">{sub}</p>}
    </div>
  );
}

export function TransactionAnalytics({
  dateFilter,
  storeId,
}: TransactionAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!storeId) return;

    setIsLoading(true);
    setError(null);

    try {
      // Must carry user_id so the server can enforce the transactions section.
      const authHeaders = buildAuthHeaders();
      const authData = authHeaders["x-auth-data"];
      if (!authData) {
        throw new Error("No auth data");
      }

      // Window start resolved in the device's timezone — see @/lib/dateFilter.
      const response = await fetch(
        `/api/transactions/analytics?${analyticsQuery(dateFilter)}`,
        {
          headers: {
            ...authHeaders,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch analytics");
      }

      const data: AnalyticsData = await response.json();
      setAnalytics(data);
    } catch (err) {
      console.error("Analytics fetch error:", err);
      setError("Could not load analytics. Please try again.");
      toast.error("Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  }, [storeId, dateFilter]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (isLoading) {
    // Skeletons in the real shape of the panel, so nothing jumps when the
    // numbers land.
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-card px-4 py-3">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton mt-2 h-6 w-24" />
              <div className="skeleton mt-2 h-3 w-14" />
            </div>
          ))}
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-white/10 bg-card p-4">
            <div className="skeleton h-40 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-card py-14 text-center">
        <p className="mb-4 text-sm text-destructive">{error || "No analytics data"}</p>
        <Button onClick={fetchAnalytics} variant="outline" className="rounded-2xl">
          Retry
        </Button>
      </div>
    );
  }

  const { summary } = analytics;

  return (
    <div className="space-y-5">
      {/* ---- Headline ----
           Four figures, so two columns on a phone and one row on a desktop
           where there is width for them to sit side by side. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={formatLLParts(summary.totalRevenue).value}
          sub={formatUSD(convertLlToUsdForReturn(summary.totalRevenue))}
          tone="primary"
        />
        <Stat
          label="Profit"
          value={formatLLParts(summary.totalProfit).value}
          sub={`Margin ${formatPercent(summary.profitMargin)}`}
          tone={summary.totalProfit >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Sales"
          value={String(summary.totalTransactions)}
          sub={`Avg. ${formatLLParts(summary.averageTransactionValue).value}`}
        />
        <Stat label="Items sold" value={String(summary.totalItemsSold)} />
      </div>

      {/* ---- When the store is busy ----
           Two charts of the same kind, so they pair naturally into two
           columns once there is room. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Sales by hour">
          <HourlySalesChart data={analytics.hourlySales} />
        </Panel>

        <Panel title="Revenue by day of week">
          <DayOfWeekChart data={analytics.dayOfWeekSales} />
        </Panel>
      </div>

      {/* ---- What sells ----
           Both lists now use the same component: revenue was a pie chart,
           which made the two halves of the same question look unrelated. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Top products by revenue">
          <RankedBarList
            items={analytics.topProductsByRevenue.map((p) => ({
              name: p.product_name,
              value: p.totalRevenue,
              primary: formatLL(p.totalRevenue),
              secondary: `×${p.totalQuantity}`,
            }))}
          />
        </Panel>

        <Panel title="Top products by quantity">
          <RankedBarList
            items={analytics.topProductsByQuantity.map((p) => ({
              name: p.product_name,
              value: p.totalQuantity,
              primary: `×${p.totalQuantity}`,
              secondary: formatLL(p.totalRevenue),
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

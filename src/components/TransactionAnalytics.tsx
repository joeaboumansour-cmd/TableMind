"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ProductPerformanceChart } from "@/components/charts/TransactionCharts";
import { HourlySalesHeatmap } from "@/components/charts/HourlySalesHeatmap";
import { DayOfWeekChart } from "@/components/charts/DayOfWeekChart";
import { SlowMovingProducts } from "@/components/SlowMovingProducts";
import {
  formatLL,
  formatLLParts,
  formatPercent,
  formatUSD,
  convertLlToUsdForSale,
} from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  slowMovingProducts: Array<{
    product_name: string;
    totalQuantity: number;
    lastSold: string;
    daysSinceLastSale: number;
  }>;
}

interface TransactionAnalyticsProps {
  dateFilter: string;
  storeId: string;
}

/** Section wrapper — one heading style for the whole panel. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      <div className="rounded-3xl border border-white/10 bg-card p-4">{children}</div>
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
      const authData = localStorage.getItem("goldensquirrel_auth");
      if (!authData) {
        throw new Error("No auth data");
      }

      const response = await fetch(
        `/api/transactions/analytics?dateFilter=${dateFilter}`,
        {
          headers: {
            "x-auth-data": authData,
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
  const maxQuantity = Math.max(
    1,
    ...analytics.topProductsByQuantity.map((p) => p.totalQuantity)
  );

  return (
    <div className="space-y-5">
      {/* ---- Headline ---- */}
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Revenue"
          value={formatLLParts(summary.totalRevenue).value}
          sub={formatUSD(convertLlToUsdForSale(summary.totalRevenue))}
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

      {/* ---- When the store is busy ---- */}
      <Panel title="Sales by hour">
        <HourlySalesHeatmap data={analytics.hourlySales} />
      </Panel>

      <Panel title="Revenue by day of week">
        <DayOfWeekChart data={analytics.dayOfWeekSales} />
      </Panel>

      {/* ---- What sells ---- */}
      <Panel title="Top products by revenue">
        <ProductPerformanceChart products={analytics.topProductsByRevenue} />
      </Panel>

      <Panel title="Top products by quantity">
        {analytics.topProductsByQuantity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing sold in this range.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {analytics.topProductsByQuantity.map((product, index) => (
              <li key={`${product.product_name}-${index}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    <span className="mr-2 text-xs text-muted-foreground tnum">
                      {index + 1}
                    </span>
                    {product.product_name}
                  </span>
                  <span className="flex-none text-right text-sm">
                    <span className="font-semibold tnum">×{product.totalQuantity}</span>
                    <span className="ml-2 text-xs text-muted-foreground tnum">
                      {formatLL(product.totalRevenue)}
                    </span>
                  </span>
                </div>
                {/* A bar reads faster than a column of numbers when you only
                    want to know which few products carry the store. */}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(product.totalQuantity / maxQuantity) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <SlowMovingProducts products={analytics.slowMovingProducts} />
    </div>
  );
}

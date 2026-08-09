"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductPerformanceChart } from "@/components/charts/TransactionCharts";
import { HourlySalesHeatmap } from "@/components/charts/HourlySalesHeatmap";
import { DayOfWeekChart } from "@/components/charts/DayOfWeekChart";
import { SlowMovingProducts } from "@/components/SlowMovingProducts";
import {
  formatLL,
  formatPercent,
  convertLlToUsdForSale,
} from "@/lib/utils/format";
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

export function TransactionAnalytics({
  dateFilter,
  storeId,
}: TransactionAnalyticsProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"dashboard" | "list">("dashboard");

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
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
            <p className="text-muted-foreground">Loading analytics...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !analytics) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-destructive mb-4">{error || "No analytics data"}</p>
          <Button onClick={fetchAnalytics} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Transaction Analytics</h2>
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as "dashboard" | "list")}
        >
          <TabsList>
            <TabsTrigger value="dashboard">📊 Dashboard</TabsTrigger>
            <TabsTrigger value="list">📋 List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {viewMode === "dashboard" ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatLL(analytics.summary.totalRevenue)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  ${convertLlToUsdForSale(analytics.summary.totalRevenue).toFixed(2)} USD
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Profit
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    analytics.summary.totalProfit >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {formatLL(analytics.summary.totalProfit)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Margin: {formatPercent(analytics.summary.profitMargin)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Transactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {analytics.summary.totalTransactions}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Avg: {formatLL(analytics.summary.averageTransactionValue)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Items Sold
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {analytics.summary.totalItemsSold}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Hourly Sales Heatmap</CardTitle>
              </CardHeader>
              <CardContent>
                <HourlySalesHeatmap data={analytics.hourlySales} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Revenue by Day of Week</CardTitle>
              </CardHeader>
              <CardContent>
                <DayOfWeekChart data={analytics.dayOfWeekSales} />
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Top 10 Products by Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                <ProductPerformanceChart products={analytics.topProductsByRevenue} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top 10 Products by Quantity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.topProductsByQuantity.map((product, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 border-b border-border/50 last:border-0"
                    >
                      <div className="flex-1">
                        <span className="font-medium text-sm">
                          {product.product_name}
                        </span>
                      </div>
                      <div className="flex gap-4 text-sm">
                        <span className="text-muted-foreground">
                          Qty: {product.totalQuantity}
                        </span>
                        <span className="font-medium">
                          {formatLL(product.totalRevenue)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Slow Moving Products */}
          <SlowMovingProducts products={analytics.slowMovingProducts} />
        </>
      ) : (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              Switch to the Transactions page to view the detailed transaction
              list.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
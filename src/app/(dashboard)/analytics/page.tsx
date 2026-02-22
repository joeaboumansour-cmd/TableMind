"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useRestaurant } from "@/app/RestaurantContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar, Users, Clock, Armchair, Target, AlertCircle, CheckCircle2, Crown,
  TrendingUp, Star, BarChart3, Activity, DollarSign, Timer, Utensils,
  TrendingDown, AlertTriangle, Sparkles, Zap, Heart, RotateCcw, PhoneCall,
  ChefHat, ThumbsUp, ThumbsDown, Clock3, CalendarDays, UserX, Wallet
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart,
  ScatterChart, Scatter, ReferenceLine
} from "recharts";
import type { AnalyticsResponse } from "@/lib/types/analytics";
import {
  calculateRFMSegment,
  getRFMSegmentColor,
  calculateHealthScore,
  getHealthScoreColor,
  type Customer
} from "@/lib/utils/customerAnalytics";

// =============================================
// Constants & Configuration
// =============================================
const STATUS_COLORS: Record<string, string> = {
  finished: "#22c55e",
  booked: "#3b82f6",
  confirmed: "#8b5cf6",
  seated: "#06b6d4",
  cancelled: "#ef4444",
  no_show: "#f59e0b"
};

const PARTY_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

const RFM_COLORS: Record<string, string> = {
  "Champions": "#22c55e",
  "Loyal Customers": "#3b82f6",
  "Potential Loyalists": "#10b981",
  "At Risk": "#f59e0b",
  "Cannot Lose Them": "#ef4444",
  "Lost": "#6b7280"
};

// =============================================
// Types
// =============================================
interface WaitlistEntry {
  id: string;
  customer_name: string;
  party_size: number;
  status: "waiting" | "seated" | "cancelled" | "no_show";
  created_at: string;
  seated_at?: string;
  estimated_wait_minutes: number;
  actual_wait_minutes?: number;
}

interface VisitLog {
  id: string;
  customer_id: string;
  visit_date: string;
  total_spend?: number;
  feedback_rating?: number;
  status: string;
}

// =============================================
// Metric Card Component
// =============================================
function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendUp,
  color = "blue",
  loading = false
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: string;
  trendUp?: boolean;
  color?: "blue" | "green" | "purple" | "orange" | "red" | "teal" | "amber";
  loading?: boolean;
}) {
  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-600",
    green: "bg-green-500/10 text-green-600",
    purple: "bg-purple-500/10 text-purple-600",
    orange: "bg-orange-500/10 text-orange-600",
    red: "bg-red-500/10 text-red-600",
    teal: "bg-teal-500/10 text-teal-600",
    amber: "bg-amber-500/10 text-amber-600"
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-12 w-12 rounded-lg mb-4" />
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-xl ${colorClasses[color]}`}>
            <Icon className="h-6 w-6" />
          </div>
          {trend && (
            <div className={`flex items-center gap-1 text-sm font-medium ${trendUp ? "text-green-600" : "text-red-600"}`}>
              {trendUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {trend}
            </div>
          )}
        </div>
        <div className="mt-4">
          <p className="text-3xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground mt-1">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================
// Insight Card Component
// =============================================
function InsightCard({
  type,
  icon: Icon,
  title,
  description,
  action
}: {
  type: "warning" | "success" | "info" | "danger";
  icon: React.ElementType;
  title: string;
  description: string;
  action?: string;
}) {
  const styles = {
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    success: "bg-green-50 border-green-200 text-green-900",
    info: "bg-blue-50 border-blue-200 text-blue-900",
    danger: "bg-red-50 border-red-200 text-red-900"
  };

  const iconColors = {
    warning: "text-amber-600",
    success: "text-green-600",
    info: "text-blue-600",
    danger: "text-red-600"
  };

  return (
    <div className={`p-4 rounded-xl border ${styles[type]}`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 mt-0.5 ${iconColors[type]}`} />
        <div className="flex-1">
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-sm mt-1 opacity-90">{description}</p>
          {action && <p className="text-xs mt-2 font-medium opacity-75">{action}</p>}
        </div>
      </div>
    </div>
  );
}

// =============================================
// Main Analytics Page
// =============================================
export default function AnalyticsPage() {
  const { restaurant } = useRestaurant();
  const restaurantId = restaurant?.id;
  const [period, setPeriod] = useState<"day" | "week" | "month" | "year">("week");

  // =============================================
  // Data Fetching
  // =============================================
  const { data: reservations = [], isLoading: reservationsLoading } = useQuery({
    queryKey: ["analytics-reservations", restaurantId, period],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("reservations")
        .select("id, customer_name, customer_id, party_size, start_time, status, table_id, created_at, actual_arrival_time, seated_at, finished_at, is_walk_in")
        .eq("restaurant_id", restaurantId)
        .order("start_time", { ascending: true });
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["analytics-customers", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, total_visits, no_show_count, cancellation_count, tags, reliability_score, last_visit_date, created_at, average_spend")
        .eq("restaurant_id", restaurantId)
        .order("total_visits", { ascending: false });
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  const { data: tables = [], isLoading: tablesLoading } = useQuery({
    queryKey: ["analytics-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tables")
        .select("id, name, capacity, section")
        .eq("restaurant_id", restaurantId);
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  const { data: visitLogs = [], isLoading: visitLogsLoading } = useQuery({
    queryKey: ["analytics-visit-logs", restaurantId, period],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("customer_visit_logs")
        .select("id, customer_id, visit_date, total_spend, feedback_rating, status")
        .eq("restaurant_id", restaurantId)
        .order("visit_date", { ascending: false });
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  const { data: waitlist = [], isLoading: waitlistLoading } = useQuery({
    queryKey: ["analytics-waitlist", restaurantId, period],
    queryFn: async () => {
      if (!restaurantId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("waitlist")
        .select("id, customer_name, party_size, status, created_at, seated_at, estimated_wait_minutes, actual_wait_minutes")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false });
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<AnalyticsResponse>({
    queryKey: ["comprehensive-analytics", restaurantId, period],
    queryFn: async () => {
      if (!restaurantId) return null as any;
      const authData = localStorage.getItem("tablemind_auth");
      const token = authData ? JSON.parse(authData).token : null;
      const tzOffset = new Date().getTimezoneOffset();

      const response = await fetch(
        `/api/analytics?action=comprehensive&restaurant_id=${restaurantId}&period=${period}&tz_offset=${tzOffset}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data?.details || data?.error);
      return data;
    },
    enabled: !!restaurantId,
  });

  const isLoading = reservationsLoading || customersLoading || tablesLoading || visitLogsLoading || waitlistLoading || analyticsLoading;

  // =============================================
  // Date Range Filtering
  // =============================================
  const getDateRange = useMemo(() => {
    const now = new Date();
    const start = new Date();
    switch (period) {
      case "day": start.setDate(now.getDate() - 1); break;
      case "week": start.setDate(now.getDate() - 7); break;
      case "month": start.setMonth(now.getMonth() - 1); break;
      case "year": start.setFullYear(now.getFullYear() - 1); break;
    }
    return { start, end: now };
  }, [period]);

  const filteredReservations = useMemo(() => {
    const { start, end } = getDateRange;
    return reservations.filter((r: any) => {
      const reservationDate = new Date(r.start_time);
      return reservationDate >= start && reservationDate <= end;
    });
  }, [reservations, getDateRange]);

  const filteredVisitLogs = useMemo(() => {
    const { start, end } = getDateRange;
    return visitLogs.filter((v: any) => {
      const visitDate = new Date(v.visit_date);
      return visitDate >= start && visitDate <= end;
    });
  }, [visitLogs, getDateRange]);

  const filteredWaitlist = useMemo(() => {
    const { start, end } = getDateRange;
    return waitlist.filter((w: any) => {
      const entryDate = new Date(w.created_at);
      return entryDate >= start && entryDate <= end;
    });
  }, [waitlist, getDateRange]);

  // =============================================
  // Core Metrics
  // =============================================
  const metrics = useMemo(() => {
    const total = filteredReservations.length;
    const finished = filteredReservations.filter((r: any) => r.status === "finished").length;
    const cancelled = filteredReservations.filter((r: any) => r.status === "cancelled").length;
    const noShows = filteredReservations.filter((r: any) => r.status === "no_show").length;
    const totalGuests = filteredReservations.reduce((acc: number, r: any) => acc + (r.party_size || 0), 0);
    const avgPartySize = total > 0 ? Math.round(totalGuests / total * 10) / 10 : 0;
    const completionRate = total > 0 ? Math.round((finished / total) * 100) : 0;
    const noShowRate = total > 0 ? Math.round((noShows / total) * 100) : 0;
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

    // Revenue metrics
    const totalRevenue = filteredVisitLogs.reduce((acc: number, v: any) => acc + (v.total_spend || 0), 0);
    const avgSpendPerVisit = filteredVisitLogs.length > 0 ? Math.round(totalRevenue / filteredVisitLogs.length * 100) / 100 : 0;
    const avgSpendPerGuest = totalGuests > 0 ? Math.round(totalRevenue / totalGuests * 100) / 100 : 0;

    // Table utilization
    const uniqueTables = new Set(filteredReservations.map((r: any) => r.table_id).filter(Boolean)).size;
    const utilization = tables.length > 0 ? Math.round((uniqueTables / tables.length) * 100) : 0;

    // Walk-in vs reservation
    const walkIns = filteredReservations.filter((r: any) => r.is_walk_in || !r.customer_id).length;
    const walkInRate = total > 0 ? Math.round((walkIns / total) * 100) : 0;

    return {
      total, finished, cancelled, noShows, totalGuests, avgPartySize,
      completionRate, noShowRate, cancellationRate, utilization, uniqueTables,
      totalRevenue, avgSpendPerVisit, avgSpendPerGuest, walkIns, walkInRate
    };
  }, [filteredReservations, filteredVisitLogs, tables]);

  // =============================================
  // Customer Analytics
  // =============================================
  const customerInsights = useMemo(() => {
    const totalCustomers = customers.length;
    const vipCustomers = customers.filter((c: any) => c.tags?.includes("VIP")).length;
    const avgVisits = totalCustomers > 0 ? Math.round(customers.reduce((acc: number, c: any) => acc + (c.total_visits || 0), 0) / totalCustomers * 10) / 10 : 0;

    // RFM Segmentation
    const rfmSegments = customers.map((c: any) => calculateRFMSegment(c as Customer));
    const rfmCounts = rfmSegments.reduce((acc: Record<string, number>, s: { segment: string }) => {
      acc[s.segment] = (acc[s.segment] || 0) + 1;
      return acc;
    }, {});

    // Health scores
    const healthScores = customers.map((c: any) => calculateHealthScore(c as Customer));
    const healthyCustomers = healthScores.filter((h: { status: string }) => h.status === "Healthy").length;
    const atRiskCustomers = healthScores.filter((h: { status: string }) => h.status === "At Risk").length;
    const criticalCustomers = healthScores.filter((h: { status: string }) => h.status === "Critical").length;

    // Churn risk
    const highRiskCustomers = customers.filter((c: any) => c.risk_level === "High").length;

    // Top customers by visits and spend
    const topCustomers = [...customers]
      .sort((a: any, b: any) => (b.total_visits || 0) - (a.total_visits || 0))
      .slice(0, 10);

    // Average customer lifetime value (estimated)
    const avgLifetimeValue = totalCustomers > 0
      ? Math.round(customers.reduce((acc: number, c: any) => acc + ((c.total_visits || 0) * (c.average_spend || metrics.avgSpendPerVisit || 50)), 0) / totalCustomers)
      : 0;

    return {
      totalCustomers, vipCustomers, avgVisits, rfmCounts, healthyCustomers,
      atRiskCustomers, criticalCustomers, highRiskCustomers, topCustomers,
      avgLifetimeValue
    };
  }, [customers, metrics.avgSpendPerVisit]);

  // =============================================
  // Waitlist Analytics
  // =============================================
  const waitlistMetrics = useMemo(() => {
    const total = filteredWaitlist.length;
    const seated = filteredWaitlist.filter((w: any) => w.status === "seated").length;
    const cancelled = filteredWaitlist.filter((w: any) => w.status === "cancelled").length;
    const noShows = filteredWaitlist.filter((w: any) => w.status === "no_show").length;

    const conversionRate = total > 0 ? Math.round((seated / total) * 100) : 0;

    const avgWaitTime = filteredWaitlist
      .filter((w: any) => w.actual_wait_minutes)
      .reduce((acc: number, w: any, _: number, arr: any[]) =>
        acc + (w.actual_wait_minutes || 0) / arr.length, 0);

    const estimatedVsActual = filteredWaitlist
      .filter((w: any) => w.actual_wait_minutes)
      .reduce((acc: number, w: any) =>
        acc + ((w.actual_wait_minutes || 0) - (w.estimated_wait_minutes || 0)), 0) /
      (filteredWaitlist.filter((w: any) => w.actual_wait_minutes).length || 1);

    return { total, seated, cancelled, noShows, conversionRate, avgWaitTime: Math.round(avgWaitTime), estimatedVsActual: Math.round(estimatedVsActual) };
  }, [filteredWaitlist]);

  // =============================================
  // Trends & Patterns
  // =============================================
  const weeklyTrend = useMemo(() => {
    const days: Record<string, any> = {};
    filteredReservations.forEach((r: any) => {
      const date = r.start_time.split("T")[0];
      if (!days[date]) days[date] = { total: 0, guests: 0, completed: 0, cancelled: 0, noShows: 0, revenue: 0 };
      days[date].total++;
      days[date].guests += r.party_size || 0;
      if (r.status === "finished") days[date].completed++;
      if (r.status === "cancelled") days[date].cancelled++;
      if (r.status === "no_show") days[date].noShows++;
    });

    // Add revenue data
    filteredVisitLogs.forEach((v: any) => {
      const date = v.visit_date.split("T")[0];
      if (days[date]) days[date].revenue += v.total_spend || 0;
    });

    const daysToShow = period === "day" ? 1 : period === "month" ? 30 : period === "year" ? 12 : 7;

    return Object.entries(days)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-daysToShow)
      .map(([date, counts]: [string, any]) => ({
        date: period === "year"
          ? new Date(date).toLocaleDateString("en-US", { month: "short" })
          : new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        ...counts
      }));
  }, [filteredReservations, filteredVisitLogs, period]);

  const hourlyDistribution = useMemo(() => {
    const hours: Record<number, { reservations: number; guests: number; revenue: number }> = {};
    reservations.forEach((r: any) => {
      const hour = new Date(r.start_time).getHours();
      if (!hours[hour]) hours[hour] = { reservations: 0, guests: 0, revenue: 0 };
      hours[hour].reservations++;
      hours[hour].guests += r.party_size || 0;
    });

    // Add revenue by hour (approximate from visit logs)
    visitLogs.forEach((v: any) => {
      const hour = new Date(v.visit_date).getHours();
      if (hours[hour]) hours[hour].revenue += v.total_spend || 0;
    });

    return Array.from({ length: 15 }, (_, i) => {
      const h = i + 9; // 9 AM to 11 PM
      return {
        hour: `${h > 12 ? h - 12 : h}${h >= 12 ? "PM" : "AM"}`,
        reservations: hours[h]?.reservations || 0,
        guests: hours[h]?.guests || 0,
        revenue: hours[h]?.revenue || 0
      };
    });
  }, [reservations, visitLogs]);

  const partySizeDistribution = useMemo(() => {
    const sizes: Record<string, { count: number; revenue: number }> = {};
    filteredReservations.forEach((r: any) => {
      const key = r.party_size <= 2 ? "1-2" : r.party_size <= 4 ? "3-4" : r.party_size <= 6 ? "5-6" : "7+";
      if (!sizes[key]) sizes[key] = { count: 0, revenue: 0 };
      sizes[key].count++;
    });

    // Approximate revenue by party size
    filteredVisitLogs.forEach((v: any) => {
      const matchingReservation = filteredReservations.find((r: any) => r.customer_id === v.customer_id);
      if (matchingReservation) {
        const key = matchingReservation.party_size <= 2 ? "1-2" : matchingReservation.party_size <= 4 ? "3-4" : matchingReservation.party_size <= 6 ? "5-6" : "7+";
        if (sizes[key]) sizes[key].revenue += v.total_spend || 0;
      }
    });

    return Object.entries(sizes).map(([name, data], i) => ({
      name,
      count: data.count,
      revenue: data.revenue,
      avgSpend: data.count > 0 ? Math.round(data.revenue / data.count * 100) / 100 : 0,
      color: PARTY_COLORS[i]
    }));
  }, [filteredReservations, filteredVisitLogs]);

  const statusBreakdown = useMemo(() => {
    const breakdown = ["finished", "booked", "confirmed", "seated", "cancelled", "no_show"].map((status) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1).replace("_", " "),
      value: reservations.filter((r: any) => r.status === status).length,
      color: STATUS_COLORS[status]
    })).filter((s) => s.value > 0);

    return breakdown;
  }, [reservations]);

  const rfmDistribution = useMemo(() => {
    return Object.entries(customerInsights.rfmCounts).map(([segment, count]) => ({
      name: segment,
      value: count,
      color: RFM_COLORS[segment] || "#6b7280"
    }));
  }, [customerInsights.rfmCounts]);

  const dayOfWeekPatterns = useMemo(() => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const patterns = days.map(day => ({
      day: day.slice(0, 3),
      reservations: 0,
      noShows: 0,
      cancellations: 0
    }));

    filteredReservations.forEach((r: any) => {
      const dayIndex = new Date(r.start_time).getDay();
      patterns[dayIndex].reservations++;
      if (r.status === "no_show") patterns[dayIndex].noShows++;
      if (r.status === "cancelled") patterns[dayIndex].cancellations++;
    });

    return patterns;
  }, [filteredReservations]);

  // =============================================
  // Pain Point Detection
  // =============================================
  const painPoints = useMemo(() => {
    const points: Array<{ type: "warning" | "danger" | "info"; icon: any; title: string; description: string; action: string }> = [];

    // No-show analysis
    if (metrics.noShowRate > 15) {
      points.push({
        type: "danger",
        icon: UserX,
        title: "Critical No-Show Rate",
        description: `Your no-show rate is ${metrics.noShowRate}%, which is significantly above industry average (5-10%).`,
        action: "Consider implementing deposits, reminders, or confirmation calls."
      });
    } else if (metrics.noShowRate > 10) {
      points.push({
        type: "warning",
        icon: AlertCircle,
        title: "High No-Show Rate",
        description: `No-show rate at ${metrics.noShowRate}%. Review customers with multiple no-shows.`,
        action: "Enable automatic SMS reminders 24 hours before reservations."
      });
    }

    // Cancellation analysis
    if (metrics.cancellationRate > 20) {
      points.push({
        type: "warning",
        icon: Calendar,
        title: "High Cancellation Rate",
        description: `${metrics.cancellationRate}% of reservations are being cancelled.`,
        action: "Review cancellation policy and overbooking strategy."
      });
    }

    // Customer retention
    if (customerInsights.criticalCustomers > customerInsights.totalCustomers * 0.2) {
      points.push({
        type: "danger",
        icon: Heart,
        title: "Customer Churn Risk",
        description: `${customerInsights.criticalCustomers} customers (${Math.round(customerInsights.criticalCustomers / customerInsights.totalCustomers * 100)}%) are at critical health status.`,
        action: "Launch win-back campaign with targeted offers."
      });
    }

    // Waitlist efficiency
    if (waitlistMetrics.conversionRate < 50 && waitlistMetrics.total > 10) {
      points.push({
        type: "warning",
        icon: Clock,
        title: "Low Waitlist Conversion",
        description: `Only ${waitlistMetrics.conversionRate}% of waitlist guests are being seated.`,
        action: "Review wait time estimates and communication."
      });
    }

    // Revenue per guest
    if (metrics.avgSpendPerGuest < 20 && metrics.total > 10) {
      points.push({
        type: "info",
        icon: DollarSign,
        title: "Low Average Spend",
        description: `Average spend per guest is $${metrics.avgSpendPerGuest}.`,
        action: "Train staff on upselling techniques and promotions."
      });
    }

    // Table utilization
    if (metrics.utilization < 50 && metrics.total > 20) {
      points.push({
        type: "info",
        icon: Armchair,
        title: "Underutilized Tables",
        description: `Only ${metrics.utilization}% of tables are being used effectively.`,
        action: "Consider promotional events or adjusting operating hours."
      });
    }

    // Peak hour bottlenecks
    const peakHour = hourlyDistribution.reduce((max, h) => h.reservations > max.reservations ? h : max, hourlyDistribution[0]);
    if (peakHour && peakHour.reservations > metrics.total * 0.3) {
      points.push({
        type: "info",
        icon: Zap,
        title: "Peak Hour Bottleneck",
        description: `${peakHour.hour} is significantly busier than other times.`,
        action: "Consider staggered seating or extended hours to spread demand."
      });
    }

    // Positive insights
    if (metrics.completionRate > 85) {
      points.push({
        type: "info",
        icon: CheckCircle2,
        title: "Excellent Completion Rate",
        description: `${metrics.completionRate}% of reservations are completed successfully.`,
        action: "Keep up the great work! Consider a loyalty program to reward regulars."
      });
    }

    if (customerInsights.vipCustomers > 0) {
      points.push({
        type: "info",
        icon: Crown,
        title: "VIP Customer Base",
        description: `You have ${customerInsights.vipCustomers} VIP customers generating premium value.`,
        action: "Ensure VIP customers receive priority treatment and exclusive offers."
      });
    }

    if (points.length === 0) {
      points.push({
        type: "info",
        icon: TrendingUp,
        title: "All Metrics Normal",
        description: "Your restaurant is performing within expected parameters.",
        action: "Continue monitoring for any changes."
      });
    }

    return points;
  }, [metrics, customerInsights, waitlistMetrics, hourlyDistribution]);

  // =============================================
  // Table Performance
  // =============================================
  const tablePerformance = useMemo(() => {
    const tableStats = tables.map((t: any) => {
      const tableReservations = filteredReservations.filter((r: any) => r.table_id === t.id);
      const completed = tableReservations.filter((r: any) => r.status === "finished").length;
      const revenue = filteredVisitLogs
        .filter((v: any) => tableReservations.some((r: any) => r.customer_id === v.customer_id))
        .reduce((acc: number, v: any) => acc + (v.total_spend || 0), 0);

      return {
        name: t.name,
        capacity: t.capacity,
        reservations: tableReservations.length,
        completionRate: tableReservations.length > 0 ? Math.round((completed / tableReservations.length) * 100) : 0,
        revenue,
        avgPartySize: tableReservations.length > 0
          ? Math.round(tableReservations.reduce((acc: number, r: any) => acc + (r.party_size || 0), 0) / tableReservations.length * 10) / 10
          : 0
      };
    }).sort((a: { revenue: number }, b: { revenue: number }) => b.revenue - a.revenue);

    return tableStats;
  }, [tables, filteredReservations, filteredVisitLogs]);

  // =============================================
  // Satisfaction Metrics
  // =============================================
  const satisfactionMetrics = useMemo(() => {
    const ratedVisits = filteredVisitLogs.filter((v: any) => v.feedback_rating);
    const avgRating = ratedVisits.length > 0
      ? Math.round(ratedVisits.reduce((acc: number, v: any) => acc + (v.feedback_rating || 0), 0) / ratedVisits.length * 10) / 10
      : 0;

    const ratingDistribution = [5, 4, 3, 2, 1].map(rating => ({
      rating: `${rating}★`,
      count: ratedVisits.filter((v: any) => v.feedback_rating === rating).length
    }));

    return { avgRating, totalRated: ratedVisits.length, ratingDistribution };
  }, [filteredVisitLogs]);

  const comprehensiveData = analyticsData?.data?.overview;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground mt-1">Comprehensive insights into your restaurant's performance</p>
        </div>
        <div className="flex gap-2">
          {(["day", "week", "month", "year"] as const).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(p)}
            >
              {p === "day" ? "Today" : p === "week" ? "7 Days" : p === "month" ? "30 Days" : "Year"}
            </Button>
          ))}
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <MetricCard
          title="Reservations"
          value={metrics.total}
          subtitle={`${metrics.finished} completed`}
          icon={Calendar}
          color="blue"
          loading={isLoading}
        />
        <MetricCard
          title="Total Guests"
          value={metrics.totalGuests}
          subtitle={`Avg ${metrics.avgPartySize} per party`}
          icon={Users}
          color="green"
          loading={isLoading}
        />
        <MetricCard
          title="Revenue"
          value={`$${metrics.totalRevenue.toLocaleString()}`}
          subtitle={`$${metrics.avgSpendPerGuest}/guest`}
          icon={DollarSign}
          color="amber"
          loading={isLoading}
        />
        <MetricCard
          title="Completion"
          value={`${metrics.completionRate}%`}
          subtitle={`${metrics.noShowRate}% no-shows`}
          icon={Target}
          trend={metrics.noShowRate > 10 ? "+" + metrics.noShowRate + "%" : undefined}
          trendUp={false}
          color={metrics.noShowRate > 10 ? "red" : "teal"}
          loading={isLoading}
        />
        <MetricCard
          title="Customers"
          value={customerInsights.totalCustomers}
          subtitle={`${customerInsights.vipCustomers} VIPs`}
          icon={Heart}
          color="purple"
          loading={isLoading}
        />
        <MetricCard
          title="Waitlist Conv."
          value={`${waitlistMetrics.conversionRate}%`}
          subtitle={`${waitlistMetrics.total} entries`}
          icon={Clock}
          color={waitlistMetrics.conversionRate < 50 ? "orange" : "green"}
          loading={isLoading}
        />
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Revenue Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Revenue & Guest Trends
              </CardTitle>
              <CardDescription>Daily revenue and guest count over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={weeklyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="guests" fill="#3b82f6" name="Guests" />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} name="Revenue ($)" />
                  <Line yAxisId="left" type="monotone" dataKey="completed" stroke="#8b5cf6" strokeWidth={2} name="Completed" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Hourly Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Peak Hours Analysis
                </CardTitle>
                <CardDescription>Reservations and revenue by hour</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <ComposedChart data={hourlyDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Bar yAxisId="left" dataKey="reservations" fill="#3b82f6" name="Reservations" />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2} name="Revenue" />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Party Size Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Party Size & Spend
                </CardTitle>
                <CardDescription>Distribution by group size and average spend</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={partySizeDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" fill="#3b82f6" name="Count" />
                    <Bar yAxisId="right" dataKey="avgSpend" fill="#22c55e" name="Avg Spend ($)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Status Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Reservation Status
                </CardTitle>
                <CardDescription>Current status distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }: any) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Day of Week Patterns */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  Day of Week Patterns
                </CardTitle>
                <CardDescription>Reservations by day with issues highlighted</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dayOfWeekPatterns}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="reservations" fill="#3b82f6" name="Reservations" />
                    <Bar dataKey="noShows" fill="#ef4444" name="No Shows" />
                    <Bar dataKey="cancellations" fill="#f59e0b" name="Cancellations" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Customers Tab */}
        <TabsContent value="customers" className="space-y-6">
          {/* Customer Health Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-500/10 rounded-xl">
                    <Heart className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{customerInsights.healthyCustomers}</p>
                    <p className="text-sm text-muted-foreground">Healthy</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-yellow-500/10 rounded-xl">
                    <AlertCircle className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{customerInsights.atRiskCustomers}</p>
                    <p className="text-sm text-muted-foreground">At Risk</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-red-500/10 rounded-xl">
                    <UserX className="h-6 w-6 text-red-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{customerInsights.criticalCustomers}</p>
                    <p className="text-sm text-muted-foreground">Critical</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-purple-500/10 rounded-xl">
                    <Wallet className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">${customerInsights.avgLifetimeValue}</p>
                    <p className="text-sm text-muted-foreground">Avg LTV</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* RFM Segmentation */}
            <Card>
              <CardHeader>
                <CardTitle>Customer Segmentation (RFM)</CardTitle>
                <CardDescription>Recency, Frequency, Monetary analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={rfmDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }: any) => value > 0 ? `${name}: ${value}` : ""}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {rfmDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top Customers */}
            <Card>
              <CardHeader>
                <CardTitle>Top Customers</CardTitle>
                <CardDescription>Your most valuable customers by visits</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[250px] overflow-y-auto">
                  {customerInsights.topCustomers.map((customer: any, index: number) => {
                    const rfm = calculateRFMSegment(customer as Customer);
                    const health = calculateHealthScore(customer as Customer);
                    return (
                      <div key={customer.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm">
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{customer.name}</p>
                            <div className="flex gap-1 mt-1">
                              <Badge variant="secondary" className={`text-xs ${getRFMSegmentColor(rfm.segment)}`}>
                                {rfm.segment}
                              </Badge>
                              <Badge variant="outline" className={`text-xs ${getHealthScoreColor(health.score)}`}>
                                {health.score} pts
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-sm">{customer.total_visits} visits</p>
                          <p className="text-xs text-muted-foreground">{customer.reliability_score || 100}% reliable</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue" className="space-y-6">
          {/* Revenue Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              title="Total Revenue"
              value={`$${metrics.totalRevenue.toLocaleString()}`}
              subtitle="Period total"
              icon={DollarSign}
              color="green"
              loading={isLoading}
            />
            <MetricCard
              title="Avg per Visit"
              value={`$${metrics.avgSpendPerVisit}`}
              subtitle="Per completed visit"
              icon={Wallet}
              color="blue"
              loading={isLoading}
            />
            <MetricCard
              title="Avg per Guest"
              value={`$${metrics.avgSpendPerGuest}`}
              subtitle="Per person"
              icon={Users}
              color="purple"
              loading={isLoading}
            />
            <MetricCard
              title="Est. LTV"
              value={`$${customerInsights.avgLifetimeValue}`}
              subtitle="Customer lifetime value"
              icon={TrendingUp}
              color="amber"
              loading={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Table Performance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Armchair className="h-5 w-5" />
                  Table Performance
                </CardTitle>
                <CardDescription>Revenue and efficiency by table</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {tablePerformance.slice(0, 10).map((table: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{table.name}</p>
                          <p className="text-xs text-muted-foreground">Capacity: {table.capacity} | Avg party: {table.avgPartySize}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-sm">${table.revenue.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{table.completionRate}% completed</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Customer Satisfaction */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Star className="h-5 w-5" />
                  Customer Satisfaction
                </CardTitle>
                <CardDescription>Feedback ratings distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center mb-6">
                  <p className="text-5xl font-bold">{satisfactionMetrics.avgRating}</p>
                  <p className="text-muted-foreground">Average rating</p>
                  <p className="text-sm text-muted-foreground">{satisfactionMetrics.totalRated} reviews</p>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={satisfactionMetrics.ratingDistribution} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis dataKey="rating" type="category" width={40} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#f59e0b" name="Reviews" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Operations Tab */}
        <TabsContent value="operations" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Table Utilization</p>
                    <p className="text-3xl font-bold mt-1">{metrics.utilization}%</p>
                    <p className="text-xs text-muted-foreground mt-1">{metrics.uniqueTables} of {tables.length} tables</p>
                  </div>
                  <div className="p-3 bg-blue-500/10 rounded-xl">
                    <Armchair className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Walk-in Rate</p>
                    <p className="text-3xl font-bold mt-1">{metrics.walkInRate}%</p>
                    <p className="text-xs text-muted-foreground mt-1">{metrics.walkIns} walk-ins</p>
                  </div>
                  <div className="p-3 bg-orange-500/10 rounded-xl">
                    <PhoneCall className="h-6 w-6 text-orange-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Wait Time</p>
                    <p className="text-3xl font-bold mt-1">{waitlistMetrics.avgWaitTime} min</p>
                    <p className="text-xs text-muted-foreground mt-1">{waitlistMetrics.estimatedVsActual > 0 ? "+" : ""}{waitlistMetrics.estimatedVsActual} vs estimate</p>
                  </div>
                  <div className="p-3 bg-purple-500/10 rounded-xl">
                    <Timer className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Waitlist Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Waitlist Performance
              </CardTitle>
              <CardDescription>Conversion and wait time trends</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-green-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-green-600">{waitlistMetrics.seated}</p>
                  <p className="text-sm text-muted-foreground">Seated</p>
                </div>
                <div className="text-center p-4 bg-red-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-red-600">{waitlistMetrics.noShows}</p>
                  <p className="text-sm text-muted-foreground">No Shows</p>
                </div>
                <div className="text-center p-4 bg-amber-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-amber-600">{waitlistMetrics.cancelled}</p>
                  <p className="text-sm text-muted-foreground">Cancelled</p>
                </div>
                <div className="text-center p-4 bg-blue-500/10 rounded-xl">
                  <p className="text-2xl font-bold text-blue-600">{waitlistMetrics.conversionRate}%</p>
                  <p className="text-sm text-muted-foreground">Conversion</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {painPoints.map((point, index) => (
              <InsightCard
                key={index}
                type={point.type}
                icon={point.icon}
                title={point.title}
                description={point.description}
                action={point.action}
              />
            ))}
          </div>

          {/* Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Actionable Recommendations
              </CardTitle>
              <CardDescription>Data-driven suggestions to improve your business</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {metrics.noShowRate > 10 && (
                  <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <PhoneCall className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">Implement Confirmation System</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        With a {metrics.noShowRate}% no-show rate, consider sending automated SMS confirmations
                        24 hours before reservations. This can reduce no-shows by up to 50%.
                      </p>
                    </div>
                  </div>
                )}

                {customerInsights.atRiskCustomers > 0 && (
                  <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <Heart className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">Launch Win-Back Campaign</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        You have {customerInsights.atRiskCustomers} at-risk customers. Send personalized offers
                        with 15-20% discounts to re-engage them before they churn.
                      </p>
                    </div>
                  </div>
                )}

                {metrics.avgSpendPerGuest < 25 && (
                  <div className="flex items-start gap-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <ChefHat className="h-5 w-5 text-purple-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">Upselling Training</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Average spend per guest is ${metrics.avgSpendPerGuest}. Train staff on suggestive selling
                        of appetizers, drinks, and desserts to increase check size by 15-20%.
                      </p>
                    </div>
                  </div>
                )}

                {waitlistMetrics.conversionRate < 60 && waitlistMetrics.total > 5 && (
                  <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <Clock className="h-5 w-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">Optimize Waitlist Communication</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Waitlist conversion is at {waitlistMetrics.conversionRate}%. Send real-time SMS updates
                        about wait status and offer a "skip the line" option during slow periods.
                      </p>
                    </div>
                  </div>
                )}

                {customerInsights.vipCustomers > 0 && (
                  <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <Crown className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">VIP Retention Program</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Reward your {customerInsights.vipCustomers} VIP customers with exclusive perks:
                        priority seating, complimentary appetizers, or special event invitations.
                      </p>
                    </div>
                  </div>
                )}

                {metrics.utilization < 60 && metrics.total > 20 && (
                  <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                    <Calendar className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-semibold">Fill Slow Periods</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Table utilization is at {metrics.utilization}%. Offer early bird specials or happy hour
                        promotions to increase bookings during off-peak hours.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

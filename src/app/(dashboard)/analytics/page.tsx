"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, Users, Clock, Armchair, Target, AlertCircle, CheckCircle2, Crown, TrendingUp, Star, BarChart3, Activity } from "lucide-react";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import type { AnalyticsResponse, ComprehensiveAnalytics } from "@/lib/types/analytics";

const supabase = createClient();

const mockReservations = [
  { id: "1", customer_name: "John Smith", party_size: 2, start_time: "2024-01-15T19:00:00", status: "finished", table_id: "1" },
  { id: "2", customer_name: "Sarah Johnson", party_size: 4, start_time: "2024-01-15T19:30:00", status: "finished", table_id: "2" },
  { id: "3", customer_name: "Mike Brown", party_size: 3, start_time: "2024-01-15T17:00:00", status: "cancelled", table_id: "2" },
  { id: "4", customer_name: "Emily Davis", party_size: 6, start_time: "2024-01-15T20:00:00", status: "finished", table_id: "4" },
  { id: "5", customer_name: "Robert Wilson", party_size: 8, start_time: "2024-01-15T18:00:00", status: "no_show", table_id: "5" },
  { id: "6", customer_name: "Lisa Chen", party_size: 2, start_time: "2024-01-16T19:00:00", status: "finished", table_id: "3" },
  { id: "7", customer_name: "David Lee", party_size: 4, start_time: "2024-01-16T20:00:00", status: "finished", table_id: "2" },
  { id: "8", customer_name: "Anna White", party_size: 2, start_time: "2024-01-16T18:30:00", status: "cancelled", table_id: "1" },
  { id: "9", customer_name: "James Brown", party_size: 6, start_time: "2024-01-17T19:00:00", status: "finished", table_id: "4" },
  { id: "10", customer_name: "Maria Garcia", party_size: 3, start_time: "2024-01-17T20:30:00", status: "finished", table_id: "2" },
];

const mockCustomers = [
  { id: "1", name: "John Smith", total_visits: 15, no_show_count: 0, cancellation_count: 1, tags: ["VIP", "Regular"], reliability_score: 94 },
  { id: "2", name: "Sarah Johnson", total_visits: 8, no_show_count: 1, cancellation_count: 2, tags: ["Regular"], reliability_score: 63 },
  { id: "3", name: "Mike Brown", total_visits: 3, no_show_count: 0, cancellation_count: 0, tags: ["Family"], reliability_score: 100 },
  { id: "4", name: "Emily Davis", total_visits: 12, no_show_count: 2, cancellation_count: 1, tags: ["Date Night"], reliability_score: 71 },
  { id: "5", name: "Robert Wilson", total_visits: 25, no_show_count: 0, cancellation_count: 0, tags: ["VIP", "High Value"], reliability_score: 100 },
];

const mockTables = [
  { id: "1", name: "Table 1", capacity: 2 },
  { id: "2", name: "Table 2", capacity: 4 },
  { id: "3", name: "Table 3", capacity: 4 },
  { id: "4", name: "Table 4", capacity: 6 },
  { id: "5", name: "Table 5", capacity: 8 },
];

const STATUS_COLORS: Record<string, string> = { finished: "#22c55e", booked: "#3b82f6", confirmed: "#8b5cf6", seated: "#06b6d4", cancelled: "#ef4444", no_show: "#f59e0b" };
const PARTY_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444"];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");

  const { data: restaurantId } = useQuery({ queryKey: ["restaurant-id"], queryFn: async () => { const { data } = await supabase.from("restaurants").select("id").limit(1).single(); return data?.id || null; } });

  const { data: reservations = mockReservations } = useQuery({
    queryKey: ["analytics-reservations", restaurantId, period],
    queryFn: async () => { if (!restaurantId) return mockReservations; const { data } = await supabase.from("reservations").select("id, customer_name, party_size, start_time, status, table_id").eq("restaurant_id", restaurantId).gte("start_time", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).order("start_time", { ascending: true }); return data?.length ? data : mockReservations; },
    enabled: !!restaurantId,
  });

  const { data: customers = mockCustomers } = useQuery({
    queryKey: ["analytics-customers", restaurantId],
    queryFn: async () => { if (!restaurantId) return mockCustomers; const { data } = await supabase.from("customers").select("id, name, total_visits, no_show_count, cancellation_count, tags").eq("restaurant_id", restaurantId).order("total_visits", { ascending: false }); return data?.length ? data : mockCustomers; },
    enabled: !!restaurantId,
  });

  const { data: tables = mockTables } = useQuery({
    queryKey: ["analytics-tables", restaurantId],
    queryFn: async () => { if (!restaurantId) return mockTables; const { data } = await supabase.from("tables").select("id, name, capacity").eq("restaurant_id", restaurantId); return data?.length ? data : mockTables; },
    enabled: !!restaurantId,
  });

  // Enhanced analytics data
  const { data: analyticsData } = useQuery({
    queryKey: ["comprehensive-analytics", restaurantId, period],
    queryFn: async () => {
      if (!restaurantId) return null;
      try {
        const response = await fetch(`/api/analytics?action=comprehensive&restaurant_id=${restaurantId}&period=${period}`);
        if (!response.ok) throw new Error('Failed to fetch analytics');
        return await response.json() as AnalyticsResponse;
      } catch (error) {
        console.error('Analytics fetch error:', error);
        return null;
      }
    },
    enabled: !!restaurantId,
  });

  const weeklyTrend = useMemo(() => {
    const days: Record<string, { total: number; guests: number; completed: number; cancelled: number; noShows: number }> = {};
    reservations.forEach((r: any) => {
      const date = r.start_time.split("T")[0];
      if (!days[date]) days[date] = { total: 0, guests: 0, completed: 0, cancelled: 0, noShows: 0 };
      days[date].total++;
      days[date].guests += r.party_size;
      if (r.status === "finished") days[date].completed++;
      if (r.status === "cancelled") days[date].cancelled++;
      if (r.status === "no_show") days[date].noShows++;
    });
    return Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, counts]) => ({ date: new Date(date).toLocaleDateString("en-US", { weekday: "short" }), ...counts }));
  }, [reservations]);

  const hourlyDistribution = useMemo(() => {
    const hours: Record<number, number> = {};
    reservations.forEach((r: any) => { const hour = new Date(r.start_time).getHours(); hours[hour] = (hours[hour] || 0) + 1; });
    return Array.from({ length: 12 }, (_, i) => { const h = i + 12; return { hour: `${h > 12 ? h - 12 : h}${h >= 12 ? "PM" : "AM"}`, reservations: hours[h] || 0 }; });
  }, [reservations]);

  const partySizeDistribution = useMemo(() => {
    const sizes: Record<string, number> = {};
    reservations.forEach((r: any) => { const key = r.party_size <= 2 ? "1-2" : r.party_size <= 4 ? "3-4" : r.party_size <= 6 ? "5-6" : "7+"; sizes[key] = (sizes[key] || 0) + 1; });
    return Object.entries(sizes).map(([name, value], i) => ({ name, value, color: PARTY_COLORS[i] }));
  }, [reservations]);

  const statusBreakdown = useMemo(() => {
    return ["finished", "booked", "confirmed", "seated", "cancelled", "no_show"].map((status) => ({ name: status.charAt(0).toUpperCase() + status.slice(1).replace("_", "-"), value: reservations.filter((r: any) => r.status === status).length, color: STATUS_COLORS[status] })).filter((s) => s.value > 0);
  }, [reservations]);

  const metrics = useMemo(() => {
    const total = reservations.length;
    const finished = reservations.filter((r: any) => r.status === "finished").length;
    const cancelled = reservations.filter((r: any) => r.status === "cancelled").length;
    const noShows = reservations.filter((r: any) => r.status === "no_show").length;
    const totalGuests = reservations.reduce((acc: number, r: any) => acc + r.party_size, 0);
    const avgPartySize = total > 0 ? Math.round(totalGuests / total) : 0;
    const completionRate = total > 0 ? Math.round((finished / total) * 100) : 0;
    const noShowRate = total > 0 ? Math.round((noShows / total) * 100) : 0;
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const uniqueTables = new Set(reservations.map((r: any) => r.table_id)).size;
    const utilization = tables.length > 0 ? Math.round((uniqueTables / tables.length) * 100) : 0;
    return { total, finished, cancelled, noShows, totalGuests, avgPartySize, completionRate, noShowRate, cancellationRate, utilization, uniqueTables };
  }, [reservations, tables]);

  const customerInsights = useMemo(() => {
    const totalCustomers = customers.length;
    const vipCustomers = customers.filter((c: any) => c.tags?.includes("VIP")).length;
    const avgVisits = totalCustomers > 0 ? Math.round(customers.reduce((acc: number, c: any) => acc + c.total_visits, 0) / totalCustomers) : 0;
    const reliable = customers.filter((c: any) => (c.reliability_score || 0) >= 80).length;
    const unreliable = customers.filter((c: any) => (c.reliability_score || 0) < 50).length;
    const topCustomers = [...customers].sort((a: any, b: any) => b.total_visits - a.total_visits).slice(0, 5);
    return { totalCustomers, vipCustomers, avgVisits, reliable, unreliable, topCustomers };
  }, [customers]);

  const insights = useMemo(() => {
    const list: { type: string; icon: any; text: string }[] = [];
    if (metrics.noShowRate > 10) list.push({ type: "warning", icon: AlertCircle, text: "High no-show rate! Consider requiring deposits or reminders." });
    if (metrics.cancellationRate > 15) list.push({ type: "warning", icon: AlertCircle, text: "Cancellation rate is above average. Review cancellation policy." });
    if (metrics.completionRate > 80) list.push({ type: "success", icon: CheckCircle2, text: "Great completion rate! Your customers are reliable." });
    if (customerInsights.vipCustomers > 0) list.push({ type: "info", icon: Crown, text: `${customerInsights.vipCustomers} VIP customers - prioritize their experience!` });
    if (list.length === 0) list.push({ type: "info", icon: TrendingUp, text: "All metrics are within normal ranges." });
    return list;
  }, [metrics, customerInsights]);

  // Enhanced analytics data processing
  const comprehensiveData = analyticsData?.data?.overview || {
    customer_segmentation: {
      new_customers: 8,
      returning_customers: 12,
      new_percentage: 40,
      returning_percentage: 60
    },
    lead_time: {
      same_day: 5,
      one_day: 3,
      two_days: 4,
      one_week: 6,
      two_weeks: 2,
      month_plus: 1,
      average_days: 3.2
    },
    day_of_week: {
      sunday: 8,
      monday: 4,
      tuesday: 6,
      wednesday: 7,
      thursday: 9,
      friday: 12,
      saturday: 10
    },
    dining_times: [
      { hour: 17, reservations: 8, avg_party_size: 2.5 },
      { hour: 18, reservations: 12, avg_party_size: 3.2 },
      { hour: 19, reservations: 15, avg_party_size: 4.1 },
      { hour: 20, reservations: 11, avg_party_size: 3.8 },
      { hour: 21, reservations: 6, avg_party_size: 2.9 }
    ],
    table_popularity: [
      { table_id: "1", table_name: "Table 1", reservations: 8, utilization_pct: 80 },
      { table_id: "2", table_name: "Table 2", reservations: 12, utilization_pct: 85 },
      { table_id: "3", table_name: "Table 3", reservations: 6, utilization_pct: 60 },
      { table_id: "4", table_name: "Table 4", reservations: 10, utilization_pct: 75 },
      { table_id: "5", table_name: "Table 5", reservations: 4, utilization_pct: 40 }
    ]
  };

  console.log('Analytics data:', analyticsData);
  console.log('Comprehensive data:', comprehensiveData);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">Analytics Dashboard</h1>
        <p className="text-xl text-muted-foreground">Comprehensive insights and metrics for your restaurant</p>
      </div>

      <div className="flex gap-2 mb-8">
        {(["day", "week", "month"] as const).map((p) => (
          <Button key={p} variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {p === "day" ? "Today" : p === "week" ? "Last 7 Days" : "Last 30 Days"}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 border-blue-500/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Reservations</p>
                    <p className="text-4xl font-bold">{metrics.total}</p>
                  </div>
                  <Calendar className="h-10 w-10 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-500/10 to-green-600/10 border-green-500/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Completion Rate</p>
                    <p className="text-4xl font-bold">{metrics.completionRate}%</p>
                  </div>
                  <Target className="h-10 w-10 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Party Size</p>
                    <p className="text-4xl font-bold">{metrics.avgPartySize}</p>
                  </div>
                  <Users className="h-10 w-10 text-purple-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/10 border-orange-500/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Table Utilization</p>
                    <p className="text-4xl font-bold">{metrics.utilization}%</p>
                  </div>
                  <Armchair className="h-10 w-10 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Enhanced Metrics */}
          {comprehensiveData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">New vs Returning Customers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>New Customers:</span>
                      <span className="font-bold">{comprehensiveData.customer_segmentation.new_customers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Returning Customers:</span>
                      <span className="font-bold">{comprehensiveData.customer_segmentation.returning_customers}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>New Customer Rate:</span>
                      <span>{comprehensiveData.customer_segmentation.new_percentage}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Lead Time Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Same Day:</span>
                      <span>{comprehensiveData.lead_time.same_day}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>1 Day:</span>
                      <span>{comprehensiveData.lead_time.one_day}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Average Days:</span>
                      <span className="font-bold">{comprehensiveData.lead_time.average_days}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Popular Dining Hours</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-sm">
                    {comprehensiveData.dining_times.slice(0, 3).map((time) => (
                      <div key={time.hour} className="flex justify-between">
                        <span>{time.hour}:00:</span>
                        <span>{time.reservations} reservations</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Reservation Trend</CardTitle>
                <CardDescription>Daily reservations over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} name="Total" />
                    <Line type="monotone" dataKey="completed" stroke="#22c55e" strokeWidth={2} name="Completed" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Hourly Distribution</CardTitle>
                <CardDescription>Busiest times of day</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={hourlyDistribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="reservations" fill="#3b82f6" name="Reservations" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Party Size Distribution</CardTitle>
                <CardDescription>Guest group sizes</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={partySizeDistribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }: any) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d"
                      dataKey="value"
                    >
                      {partySizeDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status Breakdown</CardTitle>
                <CardDescription>Reservation status distribution</CardDescription>
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
                      outerRadius={100}
                      fill="#8884d"
                      dataKey="value"
                    >
                      {statusBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="customers" className="space-y-6">
          {/* Customer Analytics */}
          {comprehensiveData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Customer Segmentation</CardTitle>
                  <CardDescription>New vs returning customer breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'New Customers', value: comprehensiveData.customer_segmentation.new_customers, color: '#3b82f6' },
                          { name: 'Returning Customers', value: comprehensiveData.customer_segmentation.returning_customers, color: '#22c55e' }
                        ]}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }: any) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                        outerRadius={100}
                        fill="#8884d"
                        dataKey="value"
                      >
                        <Cell fill="#3b82f6" />
                        <Cell fill="#22c55e" />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Lead Time Distribution</CardTitle>
                  <CardDescription>How far in advance customers book</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={[
                      { name: 'Same Day', value: comprehensiveData.lead_time.same_day },
                      { name: '1 Day', value: comprehensiveData.lead_time.one_day },
                      { name: '2 Days', value: comprehensiveData.lead_time.two_days },
                      { name: '1 Week', value: comprehensiveData.lead_time.one_week },
                      { name: '2 Weeks', value: comprehensiveData.lead_time.two_weeks },
                      { name: 'Month+', value: comprehensiveData.lead_time.month_plus }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Top Customers */}
          <Card>
            <CardHeader>
              <CardTitle>Top Customers</CardTitle>
              <CardDescription>Your most valuable customers</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {customerInsights.topCustomers.map((customer: any, index: number) => (
                  <div key={customer.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">Reliability: {customer.reliability_score}%</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">{customer.total_visits} visits</p>
                      <div className="flex gap-1 mt-1">
                        {customer.tags?.map((tag: string) => (
                          <span key={tag} className="text-xs px-2 py-1 bg-secondary rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          {comprehensiveData && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Day of Week Patterns</CardTitle>
                  <CardDescription>Reservation patterns by day of week</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={[
                      { day: 'Sunday', reservations: comprehensiveData.day_of_week.sunday },
                      { day: 'Monday', reservations: comprehensiveData.day_of_week.monday },
                      { day: 'Tuesday', reservations: comprehensiveData.day_of_week.tuesday },
                      { day: 'Wednesday', reservations: comprehensiveData.day_of_week.wednesday },
                      { day: 'Thursday', reservations: comprehensiveData.day_of_week.thursday },
                      { day: 'Friday', reservations: comprehensiveData.day_of_week.friday },
                      { day: 'Saturday', reservations: comprehensiveData.day_of_week.saturday }
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="reservations" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Dining Times Heatmap</CardTitle>
                  <CardDescription>Popular reservation times throughout the day</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={comprehensiveData.dining_times}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip />
                      <Area type="monotone" dataKey="reservations" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Table Popularity</CardTitle>
                  <CardDescription>Most requested tables and sections</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {comprehensiveData.table_popularity.map((table, index) => (
                      <div key={table.table_id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold">
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium">{table.table_name}</p>
                            <p className="text-sm text-muted-foreground">Utilization: {table.utilization_pct}%</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">{table.reservations} reservations</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="insights" className="space-y-6">
          {/* AI Insights */}
          <Card>
            <CardHeader>
              <CardTitle>AI Insights</CardTitle>
              <CardDescription>Smart recommendations for your restaurant</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {insights.map((insight, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg ${
                      insight.type === "warning"
                        ? "bg-amber-50 border border-amber-200"
                        : insight.type === "success"
                        ? "bg-green-50 border border-green-200"
                        : "bg-blue-50 border border-blue-200"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <insight.icon
                        className={`h-5 w-5 mt-0.5 ${
                          insight.type === "warning"
                            ? "text-amber-500"
                            : insight.type === "success"
                            ? "text-green-500"
                            : "text-blue-500"
                        }`}
                      />
                      <p className="text-sm">{insight.text}</p>
                    </div>
                  </div>
                ))}

                {/* Enhanced Insights */}
                {comprehensiveData && (
                  <>
                    {comprehensiveData.customer_segmentation.new_percentage > 50 && (
                      <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                        <div className="flex items-start gap-3">
                          <Star className="h-5 w-5 mt-0.5 text-blue-500" />
                          <p className="text-sm">High new customer acquisition rate! Focus on retention strategies.</p>
                        </div>
                      </div>
                    )}

                    {comprehensiveData.lead_time.average_days < 1 && (
                      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="flex items-start gap-3">
                          <Clock className="h-5 w-5 mt-0.5 text-amber-500" />
                          <p className="text-sm">Many last-minute bookings. Consider implementing advance booking incentives.</p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

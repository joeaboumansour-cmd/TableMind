"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Users, Clock, TrendingUp, ArrowRight, ChevronLeft, ChevronRight, Armchair } from "lucide-react";
import Link from "next/link";
import TimelineView from "./TimelineView";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const getTodayString = () => {
  const now = new Date();
  return now.getFullYear() + "-" + 
    String(now.getMonth() + 1).padStart(2, "0") + "-" + 
    String(now.getDate()).padStart(2, "0");
};

// Client-only date display component (prevents hydration mismatch)
function ClientDateDisplay({ date }: { date: string }) {
  const [formattedDate, setFormattedDate] = useState("");

  useEffect(() => {
    setFormattedDate(new Date(date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }));
  }, [date]);

  return <div className="text-lg font-semibold">{formattedDate}</div>;
}

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState(getTodayString());

  const navigateDate = (direction: "prev" | "next") => {
    const date = new Date(selectedDate);
    if (direction === "prev") {
      date.setDate(date.getDate() - 1);
    } else {
      date.setDate(date.getDate() + 1);
    }
    setSelectedDate(date.toISOString().split("T")[0]);
  };

  // Fetch restaurant ID
  const { data: restaurantId } = useQuery({
    queryKey: ["restaurant-id"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("id").limit(1).single();
      if (error) return null;
      return data?.id || null;
    },
  });

  // Fetch today's reservations
  const { data: reservations = [] } = useQuery({
    queryKey: ["dashboard-reservations", restaurantId, selectedDate],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("reservations")
        .select("id, party_size, start_time, end_time, status, table_id")
        .eq("restaurant_id", restaurantId)
        .gte("start_time", `${selectedDate}T00:00:00`)
        .lte("start_time", `${selectedDate}T23:59:59`);
      if (error) {
        console.error("Error fetching reservations:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!restaurantId,
  });

  // Fetch tables
  const { data: tables = [] } = useQuery({
    queryKey: ["dashboard-tables", restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from("tables")
        .select("id, name, capacity")
        .eq("restaurant_id", restaurantId);
      if (error) return [];
      return data || [];
    },
    enabled: !!restaurantId,
  });

  // Calculate metrics from real data
  const metrics = useMemo(() => {
    const totalReservations = reservations.length;
    
    // Total guests (sum of party sizes)
    const totalGuests = reservations.reduce((acc: number, r: { party_size: number }) => acc + r.party_size, 0);
    
    // Average party size
    const avgPartySize = totalReservations > 0 
      ? Math.round(totalGuests / totalReservations) 
      : 0;
    
    // Calculate average duration
    let totalDuration = 0;
    reservations.forEach((r: { start_time: string; end_time: string }) => {
      const start = new Date(r.start_time).getTime();
      const end = new Date(r.end_time).getTime();
      totalDuration += (end - start);
    });
    const avgDurationMinutes = totalReservations > 0 
      ? Math.round(totalDuration / totalReservations / 60000) 
      : 0;
    
    // Active reservations (booked, confirmed, seated)
    const activeReservations = reservations.filter(
      (r: { status: string }) => r.status === "booked" || r.status === "confirmed" || r.status === "seated"
    ).length;
    
    // Completed today (finished)
    const completedToday = reservations.filter((r: { status: string }) => r.status === "finished").length;
    
    // Cancelled/no-show
    const cancelledToday = reservations.filter(
      (r: { status: string }) => r.status === "cancelled" || r.status === "no_show"
    ).length;

    // Calculate table utilization (tables used today / total tables)
    const tablesUsedToday = new Set(reservations.map((r: { table_id: string }) => r.table_id)).size;
    const utilizationPercent = tables.length > 0 
      ? Math.round((tablesUsedToday / tables.length) * 100) 
      : 0;

    return {
      totalReservations,
      totalGuests,
      avgPartySize,
      avgDurationMinutes,
      activeReservations,
      completedToday,
      cancelledToday,
      utilizationPercent,
      tablesUsedToday,
    };
  }, [reservations, tables]);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Timeline view for visual reservation management
        </p>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigateDate("prev")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setSelectedDate(getTodayString())}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigateDate("next")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <ClientDateDisplay date={selectedDate} />
        <Link href="/reservations">
          <Button variant="outline">
            List View
          </Button>
        </Link>
      </div>

      {/* Timeline View */}
      <TimelineView selectedDate={selectedDate} />

      {/* Quick Links & Stats */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Stats Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Today's Overview</CardTitle>
            <CardDescription>Real-time statistics for {selectedDate}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-blue-500/10 rounded-xl">
                <Calendar className="h-6 w-6 mx-auto mb-2 text-blue-500" />
                <p className="text-3xl font-bold">{metrics.totalReservations}</p>
                <p className="text-sm text-muted-foreground">Reservations</p>
              </div>
              <div className="text-center p-4 bg-green-500/10 rounded-xl">
                <Users className="h-6 w-6 mx-auto mb-2 text-green-500" />
                <p className="text-3xl font-bold">{metrics.totalGuests}</p>
                <p className="text-sm text-muted-foreground">Total Guests</p>
              </div>
              <div className="text-center p-4 bg-purple-500/10 rounded-xl">
                <Clock className="h-6 w-6 mx-auto mb-2 text-purple-500" />
                <p className="text-3xl font-bold">{metrics.avgDurationMinutes}m</p>
                <p className="text-sm text-muted-foreground">Avg Duration</p>
              </div>
              <div className="text-center p-4 bg-orange-500/10 rounded-xl">
                <Armchair className="h-6 w-6 mx-auto mb-2 text-orange-500" />
                <p className="text-3xl font-bold">{metrics.utilizationPercent}%</p>
                <p className="text-sm text-muted-foreground">Utilization</p>
              </div>
            </div>
            
            {/* Additional Stats Row */}
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{metrics.activeReservations}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{metrics.completedToday}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600">{metrics.cancelledToday}</p>
                <p className="text-xs text-muted-foreground">Cancelled/NS</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/reservations">
              <div className="p-3 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors flex items-center justify-between group">
                <div>
                  <p className="font-medium">View All Reservations</p>
                  <p className="text-sm text-muted-foreground">List view with search and filters</p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </Link>
            <Link href="/analytics">
              <div className="p-3 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors flex items-center justify-between group">
                <div>
                  <p className="font-medium">Analytics</p>
                  <p className="text-sm text-muted-foreground">View insights and metrics</p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </Link>
            <Link href="/customers">
              <div className="p-3 rounded-lg bg-secondary/50 hover:bg-secondary cursor-pointer transition-colors flex items-center justify-between group">
                <div>
                  <p className="font-medium">Customers</p>
                  <p className="text-sm text-muted-foreground">Manage customer profiles</p>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>How to Use</CardTitle>
            <CardDescription>Timeline view tips</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              <strong>Click empty slot</strong> → Create new reservation
            </p>
            <p className="text-muted-foreground">
              <strong>Click reservation</strong> → View/edit details
            </p>
            <p className="text-muted-foreground">
              <strong>Drag & drop</strong> → Move to different time/table
            </p>
            <p className="text-muted-foreground">
              <strong>Green slots</strong> = Available for drop
            </p>
            <p className="text-muted-foreground">
              <strong>Red slots</strong> = Conflict/overlap
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "overview";
    const restaurantId = searchParams.get("restaurant_id");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const year = searchParams.get("year");
    const period = searchParams.get("period") || "month";
    const timezoneOffset = parseInt(searchParams.get("tz_offset") || "0"); // Minutes offset from UTC (e.g., -120 for UTC+2)

    console.log("Analytics API called:", { action, restaurantId, period, timezoneOffset });

    // Get restaurant - rely on RLS like waitlist API does
    let restaurant_id = restaurantId;
    if (!restaurant_id) {
      // Get from restaurants table via RLS
      const { data: restaurant, error: restaurantError } = await supabase
        .from("restaurants")
        .select("id")
        .limit(1)
        .single();

      if (restaurantError) {
        console.error("Restaurant fetch error:", restaurantError);
      }

      restaurant_id = restaurant?.id;
    }

    if (!restaurant_id) {
      return NextResponse.json({ error: "Restaurant not found", details: "No restaurant_id provided or found" }, { status: 404 });
    }

    // Calculate date ranges based on client's timezone
    // Get current UTC time and adjust for client's timezone
    const nowUTC = new Date();
    const nowLocal = new Date(nowUTC.getTime() - timezoneOffset * 60000);
    
    let start_date_local: Date;
    let end_date_local: Date = nowLocal;

    switch (period) {
      case "day":
        start_date_local = new Date(nowLocal.getTime() - 1 * 24 * 60 * 60 * 1000);
        break;
      case "week":
        start_date_local = new Date(nowLocal.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        start_date_local = new Date(nowLocal.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarter":
        start_date_local = new Date(nowLocal.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "year":
        start_date_local = new Date(nowLocal.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        if (startDate && endDate) {
          // Parse dates as local dates by appending time
          start_date_local = new Date(startDate + "T00:00:00");
          end_date_local = new Date(endDate + "T23:59:59");
        } else {
          start_date_local = new Date(nowLocal.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
    }

    // Convert local dates to UTC for Supabase query
    const start_date_utc = new Date(start_date_local!.getTime() + timezoneOffset * 60000);
    const end_date_utc = new Date(end_date_local.getTime() + timezoneOffset * 60000);

    const start_date_str = start_date_utc.toISOString();
    const end_date_str = end_date_utc.toISOString();

    console.log("Calling RPC with:", { restaurant_id, start_date_str, end_date_str });

    // Call the appropriate RPC function based on action
    let data: Record<string, unknown> = {};

    switch (action) {
      case "comprehensive":
        // For comprehensive analytics, we need to call multiple functions
        const { data: overview, error: comprehensiveError } = await supabase.rpc("get_comprehensive_analytics", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
        });
        
        console.log("RPC response:", { overview, comprehensiveError });
        
        if (comprehensiveError) {
          console.error("Comprehensive analytics error:", comprehensiveError);
          return NextResponse.json({ error: "Database function error", details: comprehensiveError.message }, { status: 500 });
        }
        
        if (!overview) {
          return NextResponse.json({ error: "No data returned from database", details: "The RPC function returned null" }, { status: 500 });
        }
        
        data = { overview, period: { start: start_date_str, end: end_date_str } };
        break;

      case "segmentation":
        const { data: segmentation } = await supabase.rpc("get_customer_segmentation", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
        });
        data = { segmentation };
        break;

      case "lead_time":
        const { data: leadTime } = await supabase.rpc("get_lead_time_distribution", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
        });
        data = { lead_time: leadTime };
        break;

      case "day_of_week":
        const { data: dayOfWeek } = await supabase.rpc("get_day_of_week_patterns", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
        });
        data = { day_of_week: dayOfWeek };
        break;

      case "seasonal":
        const targetYear = year ? parseInt(year) : nowLocal.getFullYear();
        const { data: seasonal } = await supabase.rpc("get_seasonal_trends", {
          p_restaurant_id: restaurant_id,
          p_year: targetYear,
        });
        data = { seasonal, year: targetYear };
        break;

      case "year_comparison":
        const currentYear = year ? parseInt(year) : nowLocal.getFullYear();
        const previousYear = currentYear - 1;
        const { data: yearComparison } = await supabase.rpc("get_year_over_year_comparison", {
          p_restaurant_id: restaurant_id,
          p_current_year: currentYear,
          p_previous_year: previousYear,
        });
        data = { year_comparison: yearComparison, current_year: currentYear, previous_year: previousYear };
        break;

      case "growth":
        // Week over week or month over month
        const currentStart = start_date_str;
        const currentEnd = end_date_str;
        const prevStart = new Date(start_date_local!.getTime() - (end_date_local.getTime() - start_date_local!.getTime()));
        const prevEnd = new Date(start_date_local!.getTime() - 1);
        const { data: growth } = await supabase.rpc("get_growth_rates", {
          p_restaurant_id: restaurant_id,
          p_current_start: currentStart,
          p_current_end: currentEnd,
          p_previous_start: prevStart.toISOString(),
          p_previous_end: prevEnd.toISOString(),
        });
        data = { growth };
        break;

      case "table_popularity":
        const { data: tablePopularity } = await supabase.rpc("get_table_popularity", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
          p_limit: 10,
        });
        data = { table_popularity: tablePopularity };
        break;

      case "dining_times":
        const { data: diningTimes } = await supabase.rpc("get_dining_times_heatmap", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
        });
        data = { dining_times: diningTimes };
        break;

      case "overview":
      default:
        // Get basic overview from reservations
        const { data: reservations } = await supabase
          .from("reservations")
          .select("party_size, status, created_at")
          .eq("restaurant_id", restaurant_id)
          .gte("start_time", start_date_str)
          .lte("start_time", end_date_str);

        const totalReservations = reservations?.length || 0;
        const totalGuests = reservations?.reduce((sum: number, r: { party_size: number | null }) => sum + (r.party_size || 0), 0) || 0;
        const avgPartySize = totalReservations > 0 ? totalGuests / totalReservations : 0;
        const completed = reservations?.filter((r: { status: string }) => r.status === "finished").length || 0;
        const cancelled = reservations?.filter((r: { status: string }) => r.status === "cancelled").length || 0;

        data = {
          overview: {
            total_reservations: totalReservations,
            total_guests: totalGuests,
            avg_party_size: Math.round(avgPartySize * 100) / 100,
            completed,
            cancelled,
          },
          period: { start: start_date_str, end: end_date_str },
        };
    }

    return NextResponse.json({
      success: true,
      data,
      meta: {
        restaurant_id,
        period,
        action,
      },
    });
  } catch (error: any) {
    console.error("Analytics API error:", error);
    return NextResponse.json(
      { 
        error: "Failed to fetch analytics", 
        details: error.message || String(error),
        stack: error.stack 
      },
      { status: 500 }
    );
  }
}

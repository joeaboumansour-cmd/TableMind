import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "overview";
    const restaurantId = searchParams.get("restaurant_id");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const year = searchParams.get("year");
    const period = searchParams.get("period") || "month";

    // Get user's restaurant
    let restaurant_id = restaurantId;
    if (!restaurant_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("restaurant_id")
        .eq("id", user.id)
        .single();

      if (!profile?.restaurant_id) {
        // Try getting from restaurants table via RLS
        const { data: restaurant } = await supabase
          .from("restaurants")
          .select("id")
          .limit(1)
          .single();

        restaurant_id = restaurant?.id;
      } else {
        restaurant_id = profile.restaurant_id;
      }
    }

    if (!restaurant_id) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // Calculate date ranges
    const now = new Date();
    let start_date: Date;
    let end_date: Date = now;

    switch (period) {
      case "week":
        start_date = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        start_date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarter":
        start_date = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "year":
        start_date = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        if (startDate && endDate) {
          start_date = new Date(startDate);
          end_date = new Date(endDate);
        } else {
          start_date = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }
    }

    const start_date_str = start_date.toISOString();
    const end_date_str = end_date.toISOString();

    // Call the appropriate RPC function based on action
    let data: Record<string, unknown> = {};

    switch (action) {
      case "comprehensive":
        // For comprehensive analytics, we need to call multiple functions
        const { data: overview } = await supabase.rpc("get_comprehensive_analytics", {
          p_restaurant_id: restaurant_id,
          p_start_date: start_date_str,
          p_end_date: end_date_str,
        });
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
        const targetYear = year ? parseInt(year) : now.getFullYear();
        const { data: seasonal } = await supabase.rpc("get_seasonal_trends", {
          p_restaurant_id: restaurant_id,
          p_year: targetYear,
        });
        data = { seasonal, year: targetYear };
        break;

      case "year_comparison":
        const currentYear = year ? parseInt(year) : now.getFullYear();
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
        const prevStart = new Date(start_date.getTime() - (end_date.getTime() - start_date.getTime()));
        const prevEnd = new Date(start_date.getTime() - 1);
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
  } catch (error) {
    console.error("Analytics API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics", details: String(error) },
      { status: 500 }
    );
  }
}

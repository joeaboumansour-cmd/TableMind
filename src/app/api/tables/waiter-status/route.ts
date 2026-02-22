import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/tables/waiter-status - Get all tables with current status and upcoming reservations
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");
    
    if (!restaurantId) {
      return NextResponse.json({ error: "Restaurant ID required" }, { status: 400 });
    }
    
    // First, ensure status records exist for all tables (auto-initialize)
    await supabase.rpc("initialize_table_status", {
      p_restaurant_id: restaurantId,
    });
    
    // Use the new function that combines current status with upcoming reservations
    const { data: tables, error } = await supabase
      .rpc("get_waiter_table_status", {
        p_restaurant_id: restaurantId,
      });
      
    if (error) {
      console.error("Error fetching waiter table status:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Transform the data to add guest_source based on the status
    const transformedTables = (tables || []).map((table: {
      table_id: string;
      table_name: string;
      table_capacity: number;
      room_name?: string;
      section?: string;
      current_status: string;
      current_customer_name?: string;
      current_party_size?: number;
      minutes_seated?: number;
      current_order_value?: number;
      reservation_id?: string;
      upcoming_reservation_id?: string;
      upcoming_customer_name?: string;
      upcoming_party_size?: number;
      upcoming_time?: string;
      upcoming_status?: string;
      minutes_until?: number;
      urgency?: string;
    }) => {
      // Determine guest source - FIXED: check if table has a reservation linked
      let guest_source: "empty" | "reservation" | "walk-in" | "reserved-soon" = "empty";
      
      if (table.current_status !== "empty") {
        // Table is occupied - check if it has a linked reservation
        if (table.reservation_id) {
          guest_source = "reservation";
        } else {
          guest_source = "walk-in";
        }
      } else if (table.upcoming_reservation_id && table.upcoming_status !== "seated") {
        // Table is empty but has upcoming reservation
        guest_source = "reserved-soon";
      }
      
      // Determine status color - 4-step flow
      const statusColors: Record<string, string> = {
        empty: "gray",
        seated: "blue",
        order_taken: "amber",
        check_requested: "violet",
        ready_to_clear: "slate",
      };
      
      return {
        ...table,
        guest_source,
        status_color: statusColors[table.current_status] || "gray",
        current_order_value: table.current_order_value || 0,
      };
    });
    
    return NextResponse.json({ tables: transformedTables });
  } catch (error) {
    console.error("GET /api/tables/waiter-status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

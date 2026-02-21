import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/tables/status - Get all table statuses with details
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
    
    // Get all table statuses with details
    const { data: tableStatuses, error } = await supabase
      .from("table_status_with_details")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("table_name", { ascending: true });
      
    if (error) {
      console.error("Error fetching table statuses:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ tableStatuses: tableStatuses || [] });
  } catch (error) {
    console.error("GET /api/tables/status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tables/status - Update table status (seat, advance service, clear)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const body = await request.json();
    const {
      table_id,
      restaurant_id,
      status, // new status
      reservation_id,
      customer_name,
      customer_id,
      party_size,
      server_id,
      server_name,
      session_notes,
    } = body;
    
    if (!table_id || !restaurant_id || !status) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    // Build update object dynamically
    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };
    
    // Set timestamps based on status
    if (status === "seated") {
      updateData.seated_at = new Date().toISOString();
      updateData.cleared_at = null;
    } else if (status === "order_taken") {
      updateData.order_taken_at = new Date().toISOString();
    } else if (status === "main_served" || status === "appetizer_served") {
      updateData.food_served_at = new Date().toISOString();
    } else if (status === "check_requested") {
      updateData.check_requested_at = new Date().toISOString();
    } else if (status === "ready_to_clear") {
      // Calculate actual duration
      const { data: currentStatus } = await supabase
        .from("table_service_status")
        .select("seated_at")
        .eq("table_id", table_id)
        .single();
        
      if (currentStatus?.seated_at) {
        const seatedAt = new Date(currentStatus.seated_at);
        const now = new Date();
        const durationMinutes = Math.floor((now.getTime() - seatedAt.getTime()) / 60000);
        updateData.actual_duration_minutes = durationMinutes;
      }
    } else if (status === "empty") {
      updateData.cleared_at = new Date().toISOString();
      // Clear customer info when table is emptied
      updateData.current_customer_name = null;
      updateData.current_customer_id = null;
      updateData.current_party_size = null;
      updateData.reservation_id = null;
      updateData.session_notes = null;
    }
    
    // Add optional fields if provided
    if (reservation_id !== undefined) updateData.reservation_id = reservation_id;
    if (customer_name !== undefined) updateData.current_customer_name = customer_name;
    if (customer_id !== undefined) updateData.current_customer_id = customer_id;
    if (party_size !== undefined) updateData.current_party_size = party_size;
    if (server_id !== undefined) updateData.server_id = server_id;
    if (server_name !== undefined) updateData.server_name = server_name;
    if (session_notes !== undefined) updateData.session_notes = session_notes;
    
    // Update or insert the status record
    const { data: result, error } = await supabase
      .from("table_service_status")
      .upsert({
        restaurant_id,
        table_id,
        ...updateData,
      }, {
        onConflict: "restaurant_id,table_id",
      })
      .select()
      .single();
      
    if (error) {
      console.error("Error updating table status:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ status: result }, { status: 200 });
  } catch (error) {
    console.error("POST /api/tables/status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

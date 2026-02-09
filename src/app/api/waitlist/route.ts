import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/waitlist - Fetch waitlist entries
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    // Get restaurant ID
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id")
      .limit(1)
      .single();
    
    if (!restaurant) {
      return NextResponse.json({ error: "No restaurant found" }, { status: 404 });
    }
    
    const restaurantId = restaurant.id;
    const status = searchParams.get("status");
    
    // Build query
    let query = supabase
      .from("waitlist")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("position", { ascending: true });
    
    if (status && status !== "all") {
      query = query.eq("status", status);
    } else {
      // Default: only show active entries
      query = query.in("status", ["waiting", "arrived", "notified"]);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error("Error fetching waitlist:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ waitlist: data || [] });
  } catch (error) {
    console.error("GET /api/waitlist error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/waitlist - Create new waitlist entry
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    
    const {
      customer_name,
      phone,
      party_size,
      notes,
      priority,
      preferences,
      estimated_wait_minutes,
    } = body;
    
    // Validation
    if (!customer_name || !party_size) {
      return NextResponse.json(
        { error: "Customer name and party size are required" },
        { status: 400 }
      );
    }
    
    if (party_size < 1 || party_size > 20) {
      return NextResponse.json(
        { error: "Party size must be between 1 and 20" },
        { status: 400 }
      );
    }
    
    // Get restaurant ID
    const { data: restaurant, error: restaurantError } = await supabase
      .from("restaurants")
      .select("id")
      .limit(1)
      .single();
    
    if (restaurantError || !restaurant) {
      return NextResponse.json({ error: "No restaurant found" }, { status: 404 });
    }
    
    const restaurantId = restaurant.id;
    
    // Get current max position
    const { data: lastEntry } = await supabase
      .from("waitlist")
      .select("position")
      .eq("restaurant_id", restaurantId)
      .in("status", ["waiting", "arrived", "notified"])
      .order("position", { ascending: false })
      .limit(1)
      .single();
    
    const newPosition = (lastEntry?.position || 0) + 1;
    
    // Calculate estimated wait if not provided
    let estimatedWait = estimated_wait_minutes;
    if (!estimatedWait) {
      const { data: settings } = await supabase
        .from("waitlist_settings")
        .select("default_estimated_wait_minutes")
        .eq("restaurant_id", restaurantId)
        .single();
      
      const avgTurnover = settings?.default_estimated_wait_minutes || 25;
      estimatedWait = newPosition * avgTurnover * 0.5;
    }
    
    // Create waitlist entry
    const { data, error } = await supabase
      .from("waitlist")
      .insert({
        restaurant_id: restaurantId,
        customer_name,
        phone,
        party_size,
        notes,
        priority: priority || "normal",
        preferences: preferences || [],
        estimated_wait_minutes: Math.round(estimatedWait),
        position: newPosition,
      })
      .select()
      .single();
    
    if (error) {
      console.error("Error creating waitlist entry:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Auto-send SMS notification if phone provided
    if (phone) {
      const { data: settings } = await supabase
        .from("waitlist_settings")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .single();
      
      if (settings?.auto_sms_notifications) {
        const message = settings.sms_template_added
          .replace("{position}", String(newPosition))
          .replace("{estimated_wait}", String(Math.round(estimatedWait)));
        
        // Queue SMS (simplified - in production use a job queue)
        await supabase.from("sms_notifications").insert({
          restaurant_id: restaurantId,
          waitlist_id: data.id,
          customer_phone: phone,
          message,
          notification_type: "added",
        });
      }
    }
    
    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (error) {
    console.error("POST /api/waitlist error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/waitlist - Update multiple entries or batch operations
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { action, ids, data } = body;
    
    if (action === "recalculate_positions") {
      // Get restaurant ID
      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("id")
        .limit(1)
        .single();
      
      if (!restaurant) {
        return NextResponse.json({ error: "No restaurant found" }, { status: 404 });
      }
      
      // Call database function to recalculate positions
      const { error } = await supabase.rpc("recalculate_waitlist_positions", {
        p_restaurant_id: restaurant.id,
      });
      
      if (error) {
        console.error("Error recalculating positions:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("PUT /api/waitlist error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/waitlist - Clear old completed entries (batch cleanup)
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const beforeDate = searchParams.get("before");
    
    if (!beforeDate) {
      return NextResponse.json(
        { error: "Date parameter required" },
        { status: 400 }
      );
    }
    
    // Get restaurant ID
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id")
      .limit(1)
      .single();
    
    if (!restaurant) {
      return NextResponse.json({ error: "No restaurant found" }, { status: 404 });
    }
    
    // Delete old completed/cancelled/left entries
    const { error, count } = await supabase
      .from("waitlist")
      .delete()
      .eq("restaurant_id", restaurant.id)
      .in("status", ["completed", "cancelled", "left"])
      .lt("created_at", beforeDate);
    
    if (error) {
      console.error("Error deleting old entries:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ deleted: count });
  } catch (error) {
    console.error("DELETE /api/waitlist error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

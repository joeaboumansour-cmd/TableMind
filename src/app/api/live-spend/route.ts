import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ============================================
// GET /api/live-spend
// Get current live spend data for restaurant
// ============================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurant_id");
    const tableId = searchParams.get("table_id");
    
    if (!restaurantId) {
      return NextResponse.json(
        { success: false, error: "Restaurant ID required" },
        { status: 400 }
      );
    }
    
    // Get current user for authorization
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    // Verify user has access to this restaurant
    const { data: userData } = await supabase
      .from("restaurant_users")
      .select("role")
      .eq("id", user.id)
      .eq("restaurant_id", restaurantId)
      .single();
    
    if (!userData) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }
    
    // Build query
    let query = supabase
      .from("live_spend_tracking")
      .select(`
        *,
        tables:table_id (name, capacity),
        reservations:reservation_id (customer_name, party_size),
        customers:customer_id (name, tags)
      `)
      .eq("restaurant_id", restaurantId);
    
    if (tableId) {
      query = query.eq("table_id", tableId);
    }
    
    // Get active sessions
    const { data: sessions, error } = await query
      .in("status", ["active", "paused"])
      .order("revpash", { ascending: false });
    
    if (error) {
      console.error("Error fetching live spend:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
    
    // Get daily summary using the view
    const { data: dailySummary } = await supabase
      .from("daily_revpash_summary")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("date", { ascending: false })
      .limit(7);
    
    // Calculate floor totals
    const floorTotals = {
      activeTables: sessions?.length || 0,
      totalCurrentSpend: sessions?.reduce((sum: number, s: any) => sum + (s.current_spend || 0), 0) || 0,
      avgRevPASH: sessions?.length 
        ? sessions.reduce((sum: number, s: any) => sum + (s.revpash || 0), 0) / sessions.length 
        : 0,
      totalGuests: sessions?.reduce((sum: number, s: any) => sum + (s.seat_count || 0), 0) || 0,
    };
    
    return NextResponse.json({
      success: true,
      data: {
        sessions: sessions || [],
        dailySummary: dailySummary || [],
        floorTotals
      }
    });
    
  } catch (error) {
    console.error("Error in live-spend GET:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================
// POST /api/live-spend
// Create a new spend tracking session
// ============================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const {
      restaurant_id,
      reservation_id,
      table_id,
      customer_id,
      seat_count,
      server_id,
      server_name,
      initial_spend,
      session_notes
    } = body;
    
    // Verify user has access
    const { data: userData } = await supabase
      .from("restaurant_users")
      .select("role, restaurant_id")
      .eq("id", user.id)
      .single();
    
    if (!userData || userData.restaurant_id !== restaurant_id) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }
    
    // Create live spend session
    const { data: session, error } = await supabase
      .from("live_spend_tracking")
      .insert({
        restaurant_id,
        reservation_id,
        table_id,
        customer_id,
        seat_count: seat_count || 1,
        server_id,
        server_name,
        current_spend: initial_spend || 0,
        session_notes,
        created_by: user.id
      })
      .select()
      .single();
    
    if (error) {
      console.error("Error creating live spend session:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
    
    // Update reservation with live_spend_id if applicable
    if (reservation_id) {
      await supabase
        .from("reservations")
        .update({ live_spend_id: session.id })
        .eq("id", reservation_id);
    }
    
    return NextResponse.json({
      success: true,
      data: session
    });
    
  } catch (error) {
    console.error("Error in live-spend POST:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================
// PATCH /api/live-spend
// Update spend for a session
// ============================================
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    const body = await request.json();
    const {
      session_id,
      additional_spend,
      new_items,
      session_notes,
      status,
      final_spend
    } = body;
    
    if (!session_id) {
      return NextResponse.json(
        { success: false, error: "Session ID required" },
        { status: 400 }
      );
    }
    
    // Get current session
    const { data: currentSession } = await supabase
      .from("live_spend_tracking")
      .select("*")
      .eq("id", session_id)
      .single();
    
    if (!currentSession) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }
    
    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
      updated_by: user.id
    };
    
    // Update spend
    if (additional_spend) {
      updateData.current_spend = (currentSession.current_spend || 0) + additional_spend;
      
      // Add to spend updates history
      const spendUpdate = {
        timestamp: new Date().toISOString(),
        amount: additional_spend,
        items: new_items || []
      };
      
      updateData.spend_updates = [
        ...(currentSession.spend_updates || []),
        spendUpdate
      ];
    }
    
    // Update items ordered
    if (new_items && new_items.length > 0) {
      updateData.items_ordered = [
        ...(currentSession.items_ordered || []),
        ...new_items
      ];
    }
    
    // Update status
    if (status) {
      updateData.status = status;
      
      // If closing session, set end time
      if (status === 'closed' || status === 'cancelled') {
        updateData.session_ended_at = new Date().toISOString();
        
        // Update reservation with final spend
        if (currentSession.reservation_id) {
          await supabase
            .from("reservations")
            .update({
              final_spend: final_spend || updateData.current_spend || currentSession.current_spend,
              revpash: currentSession.revpash
            })
            .eq("id", currentSession.reservation_id);
        }
      }
    }
    
    if (session_notes) {
      updateData.session_notes = session_notes;
    }
    
    const { data: session, error } = await supabase
      .from("live_spend_tracking")
      .update(updateData)
      .eq("id", session_id)
      .select()
      .single();
    
    if (error) {
      console.error("Error updating live spend:", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: session
    });
    
  } catch (error) {
    console.error("Error in live-spend PATCH:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================
// DELETE /api/live-spend
// Close/cancel a session
// ============================================
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    
    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "Session ID required" },
        { status: 400 }
      );
    }
    
    const { error } = await supabase
      .from("live_spend_tracking")
      .update({
        status: 'cancelled',
        session_ended_at: new Date().toISOString(),
        updated_by: user.id
      })
      .eq("id", sessionId);
    
    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: "Session cancelled"
    });
    
  } catch (error) {
    console.error("Error in live-spend DELETE:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

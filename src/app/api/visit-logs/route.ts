import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/visit-logs?customerId=xxx - Get visit logs for a customer
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId");
    const reservationId = searchParams.get("reservationId");
    
    if (!customerId && !reservationId) {
      return NextResponse.json(
        { error: "Either customerId or reservationId required" },
        { status: 400 }
      );
    }
    
    let query = supabase
      .from("customer_visit_summary")
      .select("*")
      .order("visit_date", { ascending: false });
    
    if (customerId) {
      query = query.eq("customer_id", customerId);
    }
    
    if (reservationId) {
      query = query.eq("reservation_id", reservationId);
    }
    
    const { data: visitLogs, error } = await query;
      
    if (error) {
      console.error("Error fetching visit logs:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ visitLogs: visitLogs || [] });
  } catch (error) {
    console.error("GET /api/visit-logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/visit-logs - Create a visit log with notes/feedback
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const body = await request.json();
    const {
      restaurant_id,
      customer_id,
      reservation_id,
      table_id,
      visit_date,
      party_size,
      status = "completed",
      total_spend,
      top_items_ordered,
      server_name,
      waiter_id,
      waiter_name,
      customer_notes,
      host_notes,
      feedback_rating,
      feedback_text,
      service_status,
      table_turn_time_minutes,
    } = body;
    
    if (!restaurant_id || !customer_id) {
      return NextResponse.json(
        { error: "Missing required fields: restaurant_id, customer_id" },
        { status: 400 }
      );
    }
    
    // Create the visit log
    const { data: visitLog, error } = await supabase
      .from("customer_visit_logs")
      .insert({
        restaurant_id,
        customer_id,
        reservation_id: reservation_id || null,
        table_id: table_id || null,
        visit_date: visit_date || new Date().toISOString().split("T")[0],
        visit_type: "dine_in",
        party_size: party_size || null,
        status,
        total_spend: total_spend || null,
        top_items_ordered: top_items_ordered || null,
        server_name: server_name || waiter_name || null,
        waiter_id: waiter_id || null,
        waiter_name: waiter_name || null,
        customer_notes: customer_notes || null,
        host_notes: host_notes || null,
        feedback_rating: feedback_rating || null,
        feedback_text: feedback_text || null,
        service_status: service_status || null,
        table_turn_time_minutes: table_turn_time_minutes || null,
      })
      .select()
      .single();
      
    if (error) {
      console.error("Error creating visit log:", error);
      return NextResponse.json(
        { error: "Failed to create visit log: " + error.message },
        { status: 500 }
      );
    }
    
    // Also add a note to reservation note history if reservation_id is provided
    if (reservation_id && (customer_notes || host_notes || feedback_text)) {
      const noteText = feedback_text 
        ? `[Waiter Feedback - Rating: ${feedback_rating}/5] ${feedback_text}`
        : customer_notes || host_notes;
        
      await supabase
        .from("reservation_note_history")
        .insert({
          reservation_id,
          restaurant_id,
          note_text: noteText,
          note_type: feedback_rating ? "general" : "special_occasion",
          created_at: new Date().toISOString(),
        });
    }
    
    return NextResponse.json({
      visitLog,
      message: "Visit log created successfully",
    }, { status: 201 });
    
  } catch (error) {
    console.error("POST /api/visit-logs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

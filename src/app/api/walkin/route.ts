import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/walkin - Create a walk-in reservation and seat at table
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const body = await request.json();
    const {
      restaurant_id,
      table_id,
      customer_name,
      customer_phone,
      customer_email,
      party_size,
      notes,
      server_id,
      server_name,
    } = body;
    
    if (!restaurant_id || !table_id || !customer_name || !party_size) {
      return NextResponse.json(
        { error: "Missing required fields: restaurant_id, table_id, customer_name, party_size" },
        { status: 400 }
      );
    }
    
    // 1. Find or create customer
    let customerId: string | null = null;
    let isNewCustomer = false;
    
    // Try to find by phone first
    if (customer_phone) {
      const { data: existingCustomer } = await supabase
        .from("customers")
        .select("id, total_visits")
        .eq("restaurant_id", restaurant_id)
        .eq("phone", customer_phone)
        .single();
        
      if (existingCustomer) {
        customerId = existingCustomer.id;
        
        // Update visit count
        await supabase
          .from("customers")
          .update({
            total_visits: (existingCustomer.total_visits || 0) + 1,
            last_visit_date: new Date().toISOString().split("T")[0],
            updated_at: new Date().toISOString(),
          })
          .eq("id", customerId);
      }
    }
    
    // Create new customer if not found
    if (!customerId) {
      const { data: newCustomer, error: customerError } = await supabase
        .from("customers")
        .insert({
          restaurant_id,
          name: customer_name,
          phone: customer_phone || null,
          email: customer_email || null,
          tags: ["Walk-in"],
          total_visits: 1,
          last_visit_date: new Date().toISOString().split("T")[0],
        })
        .select("id")
        .single();
        
      if (customerError) {
        console.error("Error creating customer:", customerError);
        return NextResponse.json(
          { error: "Failed to create customer: " + customerError.message },
          { status: 500 }
        );
      }
      
      customerId = newCustomer.id;
      isNewCustomer = true;
    }
    
    // 2. Calculate reservation times (default 90 min duration)
    const now = new Date();
    const endTime = new Date(now.getTime() + 90 * 60000); // 90 minutes later
    
    // 3. Create the reservation
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .insert({
        restaurant_id,
        table_id,
        customer_id: customerId,
        customer_name,
        customer_phone: customer_phone || null,
        party_size,
        start_time: now.toISOString(),
        end_time: endTime.toISOString(),
        status: "seated", // Walk-ins are immediately seated
        source: "walk_in",
        is_walk_in: true,
        notes: notes || null,
        seated_at: now.toISOString(),
        actual_arrival_time: now.toISOString(),
      })
      .select()
      .single();
      
    if (reservationError) {
      console.error("Error creating reservation:", reservationError);
      return NextResponse.json(
        { error: "Failed to create reservation: " + reservationError.message },
        { status: 500 }
      );
    }
    
    // 4. Update table status to seated
    const { data: tableStatus, error: statusError } = await supabase
      .from("table_service_status")
      .upsert({
        restaurant_id,
        table_id,
        reservation_id: reservation.id,
        status: "seated",
        current_customer_name: customer_name,
        current_customer_id: customerId,
        current_party_size: party_size,
        server_id: server_id || null,
        server_name: server_name || null,
        session_notes: notes || null,
        seated_at: now.toISOString(),
        updated_at: now.toISOString(),
      }, {
        onConflict: "restaurant_id,table_id",
      })
      .select()
      .single();
      
    if (statusError) {
      console.error("Error updating table status:", statusError);
      // Don't fail the whole request, just log it
    }
    
    return NextResponse.json({
      reservation,
      customerId,
      isNewCustomer,
      tableStatus,
      message: isNewCustomer
        ? "Walk-in guest registered and seated"
        : "Returning walk-in guest seated",
    }, { status: 201 });
    
  } catch (error) {
    console.error("POST /api/walkin error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/reservations?date=2024-01-15
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
    
    const supabase = await createClient();
    
    // Get current user from JWT
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    // TODO: Verify JWT and get user info
    // For now, fetch from localStorage on client side
    
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id")
      .limit(1)
      .single();
      
    if (!restaurant) {
      return NextResponse.json({ error: "No restaurant found" }, { status: 404 });
    }
    
    const { data: reservations, error } = await supabase
      .from("reservations")
      .select(`
        *,
        customers:customer_id (id, name, phone, tags, total_visits)
      `)
      .eq("restaurant_id", restaurant.id)
      .gte("start_time", `${date}T00:00:00`)
      .lte("start_time", `${date}T23:59:59`)
      .order("start_time", { ascending: true });
      
    if (error) {
      console.error("Error fetching reservations:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ reservations: reservations || [] });
  } catch (error) {
    console.error("GET /api/reservations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/reservations - Create new reservation with auto-customer
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      table_id, 
      customer_name, 
      customer_phone, 
      party_size, 
      start_time, 
      end_time, 
      notes,
      restaurant_id 
    } = body;
    
    if (!table_id || !customer_name || !party_size || !start_time || !end_time) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    
    const supabase = await createClient();
    
    // 1. Find or create customer
    let customerId = null;
    
    if (customer_phone) {
      // Try to find existing customer by phone
      const { data: existingCustomer } = await supabase
        .from("customers")
        .select("id")
        .eq("restaurant_id", restaurant_id)
        .eq("phone", customer_phone)
        .single();
        
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        // Create new customer
        const { data: newCustomer, error: customerError } = await supabase
          .from("customers")
          .insert({
            restaurant_id,
            name: customer_name,
            phone: customer_phone,
            tags: [],
            total_visits: 0,
          })
          .select("id")
          .single();
          
        if (customerError) {
          console.error("Error creating customer:", customerError);
        } else {
          customerId = newCustomer.id;
        }
      }
    }
    
    // 2. Create reservation
    const { data: reservation, error } = await supabase
      .from("reservations")
      .insert({
        restaurant_id,
        table_id,
        customer_id: customerId,
        customer_name,
        customer_phone,
        party_size,
        start_time,
        end_time,
        notes,
        status: "booked",
      })
      .select()
      .single();
      
    if (error) {
      console.error("Error creating reservation:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ reservation, customerId }, { status: 201 });
  } catch (error) {
    console.error("POST /api/reservations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

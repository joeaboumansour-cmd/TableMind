import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findOptimalTable, batchAssignTables, quickSuggestTable } from "@/lib/utils/tableAssignment";
import type { Table, Reservation, Customer } from "@/lib/types";

// ============================================
// POST /api/tables/auto-assign
// Auto-assign tables based on smart algorithm
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
      party_size,
      preferred_section,
      customer_id,
      reservation_time,
      mode = 'single' // 'single' or 'batch'
    } = body;
    
    if (!restaurant_id) {
      return NextResponse.json(
        { success: false, error: "Restaurant ID required" },
        { status: 400 }
      );
    }
    
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
    
    // ============================================
    // BATCH MODE: Assign multiple reservations
    // ============================================
    if (mode === 'batch' && body.reservations) {
      return handleBatchAssignment(supabase, restaurant_id, body.reservations);
    }
    
    // ============================================
    // SINGLE MODE: Assign one table
    // ============================================
    if (!party_size) {
      return NextResponse.json(
        { success: false, error: "Party size required" },
        { status: 400 }
      );
    }
    
    // Get available tables
    const { data: tables, error: tablesError } = await supabase
      .from("tables")
      .select("*")
      .eq("restaurant_id", restaurant_id)
      .eq("is_active", true)
      .order("capacity", { ascending: true });
    
    if (tablesError) {
      return NextResponse.json(
        { success: false, error: tablesError.message },
        { status: 500 }
      );
    }
    
    // Get customer info if available
    let customer: Customer | undefined;
    if (customer_id) {
      const { data: customerData } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customer_id)
        .single();
      customer = customerData || undefined;
    }
    
    // Get reservation info if available
    let reservation: Reservation | undefined;
    if (reservation_id) {
      const { data: reservationData } = await supabase
        .from("reservations")
        .select("*")
        .eq("id", reservation_id)
        .single();
      reservation = reservationData || undefined;
    }
    
    // Get recent assignments for rotation fairness
    const today = new Date().toISOString().split('T')[0];
    const { data: todayReservations } = await supabase
      .from("reservations")
      .select("table_id")
      .eq("restaurant_id", restaurant_id)
      .gte("start_time", today)
      .not("table_id", "is", null);
    
    const recentAssignments = new Map<string, number>();
    todayReservations?.forEach((r: any) => {
      if (r.table_id) {
        recentAssignments.set(r.table_id, (recentAssignments.get(r.table_id) || 0) + 1);
      }
    });
    
    // Find optimal table
    const result = findOptimalTable(
      tables as Table[],
      {
        partySize: party_size,
        preferredSection: preferred_section,
        customerId: customer_id,
        customerTags: customer?.tags,
        reservationTime: reservation_time || reservation?.start_time,
        isVip: customer?.tags?.includes('VIP') || false,
        preferredTableIds: customer?.preferred_table_id ? [customer.preferred_table_id] : undefined,
      },
      recentAssignments
    );
    
    return NextResponse.json({
      success: true,
      data: {
        recommended_table: result.recommendedTable,
        alternatives: result.alternatives,
        score: result.score,
        explanation: result.explanation,
        customer_insights: customer ? {
          is_vip: customer.tags?.includes('VIP') || false,
          total_visits: customer.total_visits,
          preferred_table: customer.preferred_table_id,
          tags: customer.tags
        } : null
      }
    });
    
  } catch (error) {
    console.error("Error in auto-assign POST:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================
// GET /api/tables/auto-assign
// Quick suggest table for immediate use
// ============================================
export async function GET(request: NextRequest) {
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
    const restaurantId = searchParams.get("restaurant_id");
    const partySize = parseInt(searchParams.get("party_size") || "0");
    const customerId = searchParams.get("customer_id");
    
    if (!restaurantId || !partySize) {
      return NextResponse.json(
        { success: false, error: "Restaurant ID and party size required" },
        { status: 400 }
      );
    }
    
    // Verify access
    const { data: userData } = await supabase
      .from("restaurant_users")
      .select("restaurant_id")
      .eq("id", user.id)
      .single();
    
    if (!userData || userData.restaurant_id !== restaurantId) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }
    
    // Get available tables
    const { data: tables } = await supabase
      .from("tables")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .gte("capacity", partySize);
    
    // Get customer if provided
    let customer: Customer | undefined;
    if (customerId) {
      const { data: customerData } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      customer = customerData || undefined;
    }
    
    // Quick suggest
    const suggestedTable = quickSuggestTable(
      partySize,
      tables as Table[] || [],
      customer
    );
    
    return NextResponse.json({
      success: true,
      data: {
        suggested_table: suggestedTable,
        customer_name: customer?.name || null,
        is_vip: customer?.tags?.includes('VIP') || false
      }
    });
    
  } catch (error) {
    console.error("Error in auto-assign GET:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ============================================
// Helper: Handle Batch Assignments
// ============================================
async function handleBatchAssignment(
  supabase: any,
  restaurantId: string,
  reservations: any[]
) {
  try {
    // Get all available tables
    const { data: tables } = await supabase
      .from("tables")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    
    // Get all customers referenced
    const customerIds = reservations
      .map(r => r.customer_id)
      .filter(Boolean);
    
    const { data: customersData } = await supabase
      .from("customers")
      .select("*")
      .in("id", customerIds);
    
    const customersMap = new Map<string, Customer>();
    customersData?.forEach((c: Customer) => customersMap.set(c.id, c));
    
    // Get recent assignments for rotation
    const today = new Date().toISOString().split('T')[0];
    const { data: todayReservations } = await supabase
      .from("reservations")
      .select("table_id")
      .eq("restaurant_id", restaurantId)
      .gte("start_time", today)
      .not("table_id", "is", null);
    
    const recentAssignments = new Map<string, number>();
    todayReservations?.forEach((r: any) => {
      if (r.table_id) {
        recentAssignments.set(r.table_id, (recentAssignments.get(r.table_id) || 0) + 1);
      }
    });
    
    // Run batch assignment
    const assignments = batchAssignTables(
      reservations as Reservation[],
      tables as Table[],
      customersMap,
      recentAssignments
    );
    
    return NextResponse.json({
      success: true,
      data: {
        assignments: assignments.map(a => ({
          reservation_id: a.reservation.id,
          assigned_table: a.assignedTable,
          score: a.score,
          alternatives: a.alternatives,
          customer_name: a.reservation.customer_name
        })),
        total_assigned: assignments.filter(a => a.assignedTable).length,
        total_unassigned: assignments.filter(a => !a.assignedTable).length
      }
    });
    
  } catch (error) {
    console.error("Error in batch assignment:", error);
    return NextResponse.json(
      { success: false, error: "Batch assignment failed" },
      { status: 500 }
    );
  }
}

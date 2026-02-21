import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/reservations/[id]/visit - Record guest arrival/visit
 * 
 * IMPORTANT: Customer stats (total_visits, no_show_count, cancellation_count) 
 * are automatically managed by database triggers when reservation status changes.
 * This endpoint only updates reservation status and timing fields.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { 
      action, // 'arrive', 'seat', 'finish', 'no_show', 'cancel'
      actual_arrival_time,
      notes 
    } = body;
    
    const supabase = await createClient();
    
    // Get reservation to calculate minutes early/late
    const { data: reservation } = await supabase
      .from("reservations")
      .select("start_time, customer_id")
      .eq("id", id)
      .single();
      
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    
    const now = new Date();
    const scheduledTime = new Date(reservation.start_time);
    const arrivalTime = actual_arrival_time ? new Date(actual_arrival_time) : now;
    
    // Calculate minutes early (positive) or late (negative)
    const diffMs = scheduledTime.getTime() - arrivalTime.getTime();
    const minutesEarlyLate = Math.round(diffMs / (1000 * 60));
    
    let updateData: Record<string, unknown> = {
      updated_at: now.toISOString(),
    };
    
    // Map action to status update
    // NOTE: Database trigger handles customer stats automatically
    switch (action) {
      case 'arrive':
        updateData = {
          ...updateData,
          actual_arrival_time: arrivalTime.toISOString(),
          minutes_early_late: minutesEarlyLate,
          status: 'confirmed',
        };
        break;
        
      case 'seat':
        updateData = {
          ...updateData,
          seated_at: now.toISOString(),
          status: 'seated',
          visit_completed: true,
        };
        // Customer visit count is automatically incremented by database trigger
        break;
        
      case 'finish':
        updateData = {
          ...updateData,
          finished_at: now.toISOString(),
          status: 'finished',
          visit_completed: true,
        };
        // Customer visit count is automatically incremented by database trigger (if not already seated)
        break;
        
      case 'no_show':
        updateData = {
          ...updateData,
          no_show: true,
          status: 'no_show',
        };
        // Customer no_show_count is automatically incremented by database trigger
        break;
        
      case 'cancel':
        updateData = {
          ...updateData,
          status: 'cancelled',
        };
        // Customer cancellation_count is automatically incremented by database trigger
        break;
    }
    
    if (notes) {
      updateData.notes = notes;
    }
    
    const { data: updatedReservation, error } = await supabase
      .from("reservations")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();
      
    if (error) {
      console.error("Error recording visit:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      reservation: updatedReservation,
      minutesEarlyLate,
      message: action === 'arrive' 
        ? minutesEarlyLate > 0 
          ? `Guest arrived ${minutesEarlyLate} minutes early`
          : minutesEarlyLate < 0
            ? `Guest arrived ${Math.abs(minutesEarlyLate)} minutes late`
            : 'Guest arrived on time'
        : `Guest ${action}ed successfully`
    });
  } catch (error) {
    console.error("POST /api/reservations/[id]/visit error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

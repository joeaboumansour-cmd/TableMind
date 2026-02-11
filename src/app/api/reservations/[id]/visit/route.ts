import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/reservations/[id]/visit - Record guest arrival/visit
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
    
    let updateData: any = {
      updated_at: now.toISOString(),
    };
    
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
        // Increment customer visit count
        if (reservation.customer_id) {
          try {
            await supabase.rpc('increment_customer_visit', {
              customer_id: reservation.customer_id
            });
          } catch {
            // Fallback: directly update customer if RPC doesn't exist
            await supabase
              .from('customers')
              .update({ 
                total_visits: supabase.rpc('coalesce', { val: supabase.raw('total_visits'), default_val: 0 }) + 1,
                last_visit_date: now.toISOString(),
                updated_at: now.toISOString()
              })
              .eq('id', reservation.customer_id);
          }
        }
        break;
        
      case 'finish':
        updateData = {
          ...updateData,
          finished_at: now.toISOString(),
          status: 'finished',
          visit_completed: true,
        };
        // Also increment visit count if customer wasn't already seated
        if (reservation.customer_id) {
          try {
            await supabase.rpc('increment_customer_visit', {
              customer_id: reservation.customer_id
            });
          } catch {
            // Fallback: directly update customer if RPC doesn't exist
            const { data: customer } = await supabase
              .from('customers')
              .select('total_visits')
              .eq('id', reservation.customer_id)
              .single();
            await supabase
              .from('customers')
              .update({ 
                total_visits: (customer?.total_visits || 0) + 1,
                last_visit_date: now.toISOString(),
                updated_at: now.toISOString()
              })
              .eq('id', reservation.customer_id);
          }
        }
        break;
        
      case 'no_show':
        updateData = {
          ...updateData,
          no_show: true,
          status: 'no_show',
        };
        // Increment customer no-show count
        if (reservation.customer_id) {
          try {
            await supabase.rpc('increment_customer_no_show', {
              customer_id: reservation.customer_id
            });
          } catch {
            // Fallback: directly update customer if RPC doesn't exist
            const { data: customer } = await supabase
              .from('customers')
              .select('no_show_count')
              .eq('id', reservation.customer_id)
              .single();
            await supabase
              .from('customers')
              .update({ 
                no_show_count: (customer?.no_show_count || 0) + 1,
                updated_at: now.toISOString()
              })
              .eq('id', reservation.customer_id);
          }
        }
        break;
        
      case 'cancel':
        updateData = {
          ...updateData,
          status: 'cancelled',
        };
        // Increment customer cancellation count
        if (reservation.customer_id) {
          try {
            await supabase.rpc('increment_customer_cancellation', {
              customer_id: reservation.customer_id
            });
          } catch {
            // Fallback: directly update customer if RPC doesn't exist
            const { data: customer } = await supabase
              .from('customers')
              .select('cancellation_count')
              .eq('id', reservation.customer_id)
              .single();
            await supabase
              .from('customers')
              .update({ 
                cancellation_count: (customer?.cancellation_count || 0) + 1,
                updated_at: now.toISOString()
              })
              .eq('id', reservation.customer_id);
          }
        }
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

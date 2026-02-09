import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/waitlist/[id] - Fetch single waitlist entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    
    const { data, error } = await supabase
      .from("waitlist")
      .select("*")
      .eq("id", id)
      .single();
    
    if (error) {
      console.error("Error fetching waitlist entry:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (!data) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    
    return NextResponse.json({ entry: data });
  } catch (error) {
    console.error("GET /api/waitlist/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/waitlist/[id] - Update waitlist entry
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const body = await request.json();
    
    const {
      customer_name,
      phone,
      party_size,
      notes,
      priority,
      preferences,
      status,
    } = body;
    
    const updateData: Record<string, unknown> = {};
    if (customer_name !== undefined) updateData.customer_name = customer_name;
    if (phone !== undefined) updateData.phone = phone;
    if (party_size !== undefined) {
      if (party_size < 1 || party_size > 20) {
        return NextResponse.json(
          { error: "Party size must be between 1 and 20" },
          { status: 400 }
        );
      }
      updateData.party_size = party_size;
    }
    if (notes !== undefined) updateData.notes = notes;
    if (priority !== undefined) updateData.priority = priority;
    if (preferences !== undefined) updateData.preferences = preferences;
    
    if (status !== undefined) {
      updateData.status = status;
      const now = new Date().toISOString();
      switch (status) {
        case "arrived": updateData.arrived_at = now; break;
        case "notified": updateData.notified_at = now; break;
        case "seated":
          updateData.seated_at = now;
          const { data: entry } = await supabase
            .from("waitlist")
            .select("created_at")
            .eq("id", id)
            .single();
          if (entry?.created_at) {
            const waitMinutes = Math.round(
              (new Date(now).getTime() - new Date(entry.created_at).getTime()) / 60000
            );
            updateData.actual_wait_minutes = waitMinutes;
          }
          break;
        case "left":
        case "cancelled": updateData.left_at = now; break;
        case "completed": updateData.seated_at = now; break;
      }
    }
    
    const { data, error } = await supabase
      .from("waitlist")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();
    
    if (error) {
      console.error("Error updating waitlist entry:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ entry: data });
  } catch (error) {
    console.error("PUT /api/waitlist/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/waitlist/[id] - Remove waitlist entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    
    const { error } = await supabase.from("waitlist").delete().eq("id", id);
    
    if (error) {
      console.error("Error deleting waitlist entry:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/waitlist/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

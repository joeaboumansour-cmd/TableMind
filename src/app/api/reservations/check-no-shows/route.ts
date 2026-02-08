import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// POST /api/reservations/check-no-shows
// Manually trigger no-show detection (can also be called by cron job)
export async function POST() {
  try {
    const supabase = await createClient();

    // Call the database function to mark no-shows
    const { data, error } = await supabase.rpc("mark_no_shows");

    if (error) {
      console.error("Error checking no-shows:", error);
      return NextResponse.json(
        { error: "Failed to check no-shows" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Marked ${data} reservations as no-show`,
      count: data,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/reservations/check-no-shows
// Get count of potential no-shows (for admin dashboard)
export async function GET() {
  try {
    const supabase = await createClient();

    // Count reservations that would be marked as no-show
    const { count, error } = await supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .in("status", ["booked", "confirmed"])
      .lt("start_time", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    if (error) {
      console.error("Error counting potential no-shows:", error);
      return NextResponse.json(
        { error: "Failed to count potential no-shows" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      potentialNoShows: count || 0,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

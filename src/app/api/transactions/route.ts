import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.error("Supabase URL not configured");
      return NextResponse.json({ 
        error: "Supabase URL not configured", 
        details: "Please set NEXT_PUBLIC_SUPABASE_URL in .env.local" 
      }, { status: 500 });
    }
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Supabase Service Role Key not configured");
      return NextResponse.json({ 
        error: "Supabase Service Role Key not configured", 
        details: "Please set SUPABASE_SERVICE_ROLE_KEY in .env.local" 
      }, { status: 500 });
    }

    const supabase = await createServiceRoleClient();
    
    // Get auth data from request headers
    const authData = request.headers.get('x-auth-data');
    if (!authData) {
      return NextResponse.json({ error: "Unauthorized - No auth data provided" }, { status: 401 });
    }

    let store_id;
    try {
      const parsed = JSON.parse(authData);
      store_id = parsed.store_id;
    } catch (e) {
      return NextResponse.json({ error: "Unauthorized - Invalid auth data format" }, { status: 401 });
    }

    if (!store_id) {
      return NextResponse.json({ error: "Unauthorized - No store_id in auth data" }, { status: 401 });
    }

    // TRANSACTIONS DISABLED - 4/19/2026
    // Query transactions from the last 48 hours only
    // const { data: transactions, error } = await supabase
    //   .from("transactions")
    //   .select(`
    //     id,
    //     transaction_number,
    //     subtotal,
    //     total_amount,
    //     amount_paid,
    //     change_given,
    //     created_at,
    //     transaction_items (
    //       id,
    //       product_name,
    //       quantity,
    //       unit_price,
    //       total_price
    //     )
    //   `)
    //   .eq("store_id", store_id)
    //   .gte("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    //   .order("created_at", { ascending: false });

    // if (error) {
    //   console.error("Supabase query error:", error);
    //   return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    // }

    // Always return empty array - transactions are disabled
    return NextResponse.json({ transactions: [] });
  } catch (error: any) {
    console.error("Error fetching transactions:", error);
    return NextResponse.json({ 
      error: "Failed to fetch transactions", 
      details: error?.message || String(error) 
    }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    
    // Get auth data from cookies
    const authData = request.headers.get('x-auth-data');
    if (!authData) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { store_id } = JSON.parse(authData);

    // TRANSACTIONS DISABLED - 4/19/2026
    // Delete transactions older than 48 hours
    // const { data, error } = await supabase
    //   .from("transactions")
    //   .delete()
    //   .eq("store_id", store_id)
    //   .lt("created_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

    // if (error) {
    //   throw error;
    // }

    // Return success without doing anything
    return NextResponse.json({ message: "Old transactions cleaned up", deleted: 0 });
  } catch (error) {
    console.error("Error cleaning up transactions:", error);
    return NextResponse.json({ error: "Failed to clean up transactions" }, { status: 500 });
  }
}
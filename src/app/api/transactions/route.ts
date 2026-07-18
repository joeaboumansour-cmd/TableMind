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

    // Get store retention settings first
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("transaction_retention_days, max_transactions")
      .eq("id", store_id)
      .single();

    if (storeError) {
      console.error("Error fetching store settings:", storeError);
      return NextResponse.json({ error: "Failed to fetch store settings", details: storeError }, { status: 500 });
    }

    // Build query - filter based on retention days
    let query = supabase
      .from("transactions")
      .select(`
        id,
        transaction_number,
        subtotal,
        total_amount,
        amount_paid,
        change_given,
        created_at,
        whatsapp_sent_to,
        whatsapp_sent_at,
        transaction_items (
          id,
          product_name,
          quantity,
          unit_price,
          total_price,
          currency
        )
      `)
      .eq("store_id", store_id)
      .order("created_at", { ascending: false });

    // Apply time filter only if retention_days is set and not 0
    if (store.transaction_retention_days && store.transaction_retention_days > 0) {
      const cutoffDate = new Date(Date.now() - store.transaction_retention_days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", cutoffDate);
    }

    const { data: transactions, error } = await query;

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    return NextResponse.json({ transactions: transactions || [] });
  } catch (error: any) {
    console.error("Error fetching transactions:", error);
    return NextResponse.json({ 
      error: "Failed to fetch transactions", 
      details: error?.message || String(error) 
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServiceRoleClient();
    
    const authData = request.headers.get('x-auth-data');
    if (!authData) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { store_id } = JSON.parse(authData);
    const body = await request.json();
    
    // Create transaction
    const { data: transaction, error } = await supabase
      .from("transactions")
      .insert({
        store_id: store_id,
        transaction_number: body.transaction_number,
        subtotal: body.subtotal,
        total_amount: body.total_amount,
        amount_paid: body.amount_paid,
        change_given: body.change_given || 0,
        payment_method: body.payment_method || 'cash',
        usd_subtotal: body.usd_subtotal,
        usd_total_amount: body.usd_total_amount,
        usd_amount_paid: body.usd_amount_paid || 0,
        usd_change_given: body.usd_change_given || 0,
      })
      .select()
      .single();

    if (error) {
      console.error("Transaction creation error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Insert transaction items if provided
    if (body.items && body.items.length > 0) {
      const txnItems = body.items.map((item: any) => ({
        store_id: store_id,
        transaction_id: transaction.id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        currency: item.currency || 'LL',
      }));

      const { error: itemsError } = await supabase
        .from("transaction_items")
        .insert(txnItems);

      if (itemsError) {
        console.error("Transaction items error:", itemsError);
        // Transaction created but items failed - still return success but log error
      }
    }

    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error: any) {
    console.error("Error creating transaction:", error);
    return NextResponse.json({ 
      error: "Failed to create transaction", 
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

    // Call cleanup function for this store
    const { data, error } = await supabase
      .rpc("cleanup_old_transactions_for_store", {
        p_store_id: store_id
      });

    if (error) {
      console.error("Cleanup error:", error);
      return NextResponse.json({ error: "Failed to clean up transactions", details: error }, { status: 500 });
    }

    const result = data as any;
    return NextResponse.json({ 
      message: "Transactions cleaned up", 
      deleted: result?.deleted_count || 0,
      reason: result?.reason || "completed"
    });
  } catch (error) {
    console.error("Error cleaning up transactions:", error);
    return NextResponse.json({ error: "Failed to clean up transactions" }, { status: 500 });
  }
}
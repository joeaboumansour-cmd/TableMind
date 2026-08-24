import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// History is browsed newest-first and the client loads more on demand, so a
// page needs to cover a screen or two, not the whole store's lifetime.
const DEFAULT_PAGE_SIZE = 50;
// Hard ceiling regardless of what the caller asks for. Each row carries its
// nested transaction_items, so large pages get expensive quickly.
const MAX_PAGE_SIZE = 200;

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

    // ---- Pagination ----
    // This query previously had no limit at all. PostgREST caps an unbounded
    // select at max-rows (1000) with no error, so any store past 1000
    // transactions was silently shown a truncated history — and every request
    // dragged the full nested transaction_items payload for all of it.
    const url = new URL(request.url);

    const rawLimit = url.searchParams.get("limit");
    let limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      return NextResponse.json(
        { error: "limit must be a positive integer" },
        { status: 400 }
      );
    }
    limit = Math.min(limit, MAX_PAGE_SIZE);

    // Keyset cursor: "<created_at>|<id>". Keyset rather than offset so that a
    // sale completed while the cashier is scrolling cannot shift the window
    // and cause a row to be skipped or shown twice.
    const cursor = url.searchParams.get("cursor");
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const sep = cursor.lastIndexOf("|");
      cursorCreatedAt = sep === -1 ? null : cursor.slice(0, sep);
      cursorId = sep === -1 ? null : cursor.slice(sep + 1);
      if (!cursorCreatedAt || !cursorId || Number.isNaN(Date.parse(cursorCreatedAt))) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
    }

    // Build query - filter based on retention days
    let query = supabase
      .from("transactions")
      .select(`
        id,
        transaction_number,
        receipt_token,
        subtotal,
        total_amount,
        amount_paid,
        change_given,
        created_at,
        user_id,
        user_name,
        transaction_items (
          id,
          product_id,
          product_name,
          quantity,
          unit_price,
          total_price,
          currency
        )
      `)
      .eq("store_id", store_id)
      // id is the tiebreaker; without a unique second sort key, rows sharing
      // a created_at can be skipped or duplicated across page boundaries.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // Apply time filter only if retention_days is set and not 0
    if (store.transaction_retention_days && store.transaction_retention_days > 0) {
      const cutoffDate = new Date(Date.now() - store.transaction_retention_days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", cutoffDate);
    }

    if (cursorCreatedAt && cursorId) {
      // Strictly "after" the cursor in (created_at DESC, id DESC) order.
      query = query.or(
        `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`
      );
    }

    // Fetch one extra row to determine whether another page exists, without
    // paying for a separate COUNT.
    const { data: rows, error } = await query.limit(limit + 1);

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    const page = rows || [];
    const hasMore = page.length > limit;
    const transactions = hasMore ? page.slice(0, limit) : page;

    const last = transactions[transactions.length - 1] as
      | { created_at: string; id: string }
      | undefined;
    const nextCursor = hasMore && last ? `${last.created_at}|${last.id}` : null;

    return NextResponse.json({ transactions, nextCursor, hasMore });
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

    // When the sale actually happened.
    //
    // Offline sales sit in the local queue until the shop reconnects, and this
    // field was previously not sent and not stored — so Postgres applied its
    // DEFAULT NOW() and three days of offline trading was all recorded as
    // having happened on the day the link came back. That corrupts cash-shift
    // reconciliation (021_cash_management.sql matches on created_at::date) and
    // the hourly/weekday analytics. (audit P1-1)
    //
    // Clamped rather than trusted: created_at comes from a till's own clock,
    // and shop-floor devices drift. A future timestamp would put sales in a
    // shift that has not started yet, so anything ahead of the server's clock
    // is pulled back to now. An unparseable or absent value falls through to
    // the column default, which is the old behaviour.
    const saleTime = (() => {
      if (!body.created_at) return null;
      const parsed = Date.parse(body.created_at);
      if (Number.isNaN(parsed)) return null;
      return new Date(Math.min(parsed, Date.now())).toISOString();
    })();

    // Check if a transaction with this transaction_number already exists for this store
    // This prevents duplicate entries when the sync engine pushes the same queued transaction twice
    const { data: existingTxn } = await supabase
      .from("transactions")
      .select("id")
      .eq("store_id", store_id)
      .eq("transaction_number", body.transaction_number)
      .maybeSingle();

    if (existingTxn) {
      console.log(`[API] Transaction ${body.transaction_number} already exists, skipping duplicate`);
      // Fetch the full existing transaction to return it
      const { data: existing, error: fetchError } = await supabase
        .from("transactions")
        .select(`
          id,
          transaction_number,
          subtotal,
          total_amount,
          amount_paid,
          change_given,
        created_at,
        user_id,
        user_name,
        transaction_items (
          id,
          product_id,
          product_name,
          quantity,
          unit_price,
          total_price,
          currency
        )
      `)
      .eq("id", existingTxn.id)
      .single();

      if (fetchError) {
        return NextResponse.json({ error: fetchError.message }, { status: 500 });
      }

      return NextResponse.json({ transaction: existing, duplicated: true }, { status: 200 });
    }

    // Create transaction
    const { data: transaction, error } = await supabase
      .from("transactions")
      .insert({
        store_id: store_id,
        transaction_number: body.transaction_number,
        // Store the receipt token so the public receipt page can find it
        ...(body.receipt_token && {
          receipt_token: body.receipt_token,
        }),
        // Omitted when the client did not send a usable timestamp, so the
        // column default (NOW()) still applies for online sales.
        ...(saleTime && { created_at: saleTime }),
        subtotal: body.subtotal,
        total_amount: body.total_amount,
        amount_paid: body.amount_paid,
        change_given: body.change_given || 0,
        payment_method: body.payment_method || 'cash',
        usd_subtotal: body.usd_subtotal,
        usd_total_amount: body.usd_total_amount,
        usd_amount_paid: body.usd_amount_paid || 0,
        usd_change_given: body.usd_change_given || 0,
        // Always save user_name if provided (for all users: owners and employees)
        ...(body.user_name && {
          user_name: body.user_name,
        }),
        // Only save user_id for employees (references store_users table)
        ...(body.user_id && {
          user_id: body.user_id,
        }),
      })
      .select()
      .single();

    if (error) {
      // Handle unique constraint violation as a fallback safety net
      if (error.code === '23505') {
        console.log(`[API] Duplicate key violation for ${body.transaction_number}, treating as duplicate`);
        // Fetch the existing transaction
        const { data: existing } = await supabase
          .from("transactions")
          .select(`
            id,
            transaction_number,
            subtotal,
            total_amount,
            amount_paid,
            change_given,
        created_at,
        user_id,
        user_name,
        transaction_items (
          id,
          product_id,
          product_name,
          quantity,
          unit_price,
          total_price,
          currency
        )
      `)
      .eq("store_id", store_id)
      .eq("transaction_number", body.transaction_number)
      .single();

        if (existing) {
          return NextResponse.json({ transaction: existing, duplicated: true }, { status: 200 });
        }
      }
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

      // CRITICAL FIX: Decrement stock server-side for each item.
      // This ensures stock is decremented exactly once per transaction,
      // whether the transaction was created online or synced from offline.
      // Uses the service role client (bypasses RLS) so the RPC works reliably.
      for (const item of body.items) {
        if (!item.product_id) continue;
        const { error: stockError } = await supabase.rpc("decrement_stock", {
          product_id: item.product_id,
          quantity: item.quantity,
          p_store_id: store_id,
        });

        if (stockError) {
          console.error(`[API] Stock decrement failed for product ${item.product_id}:`, stockError);
          // Don't fail the transaction — log and continue.
          // The transaction is already created; stock can be reconciled later.
        }
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
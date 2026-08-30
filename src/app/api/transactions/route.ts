import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse, after } from "next/server";
import { resolveCaller, readAuthHeader, canAccessSection } from "@/lib/auth/apiCaller";

// History is browsed newest-first and the client loads more on demand, so a
// page needs to cover a screen or two, not the whole store's lifetime.
const DEFAULT_PAGE_SIZE = 50;
// Hard ceiling regardless of what the caller asks for. Each row carries its
// nested transaction_items, so large pages get expensive quickly.
const MAX_PAGE_SIZE = 200;

/**
 * How often one server instance is willing to run the retention sweep.
 *
 * Retention used to be an AFTER INSERT ... FOR EACH ROW trigger (migration
 * 012) that counted the store's entire transaction table and ran two DELETEs
 * inside the transaction taking the customer's money. Migration 037 drops it
 * and this replaces it: the same `cleanup_old_transactions_for_store` the
 * DELETE handler already calls, run at most hourly, after the response.
 *
 * Module scope, so it is per warm serverless instance — the same
 * best-effort throttle POST /api/activity uses. Missing a sweep costs
 * nothing; the policy is a ceiling, not a deadline.
 */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const lastRetentionSweepAt = new Map<string, number>();

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

function maybeRunRetentionCleanup(supabase: ServiceClient, storeId: string): void {
  if (!storeId) return;

  const now = Date.now();
  const last = lastRetentionSweepAt.get(storeId) ?? 0;
  if (now - last < RETENTION_SWEEP_INTERVAL_MS) return;
  lastRetentionSweepAt.set(storeId, now);

  // A long-lived instance serving many stores must not grow this map without
  // bound. Anything older than two windows cannot block a sweep anyway.
  if (lastRetentionSweepAt.size > 500) {
    for (const [id, at] of lastRetentionSweepAt) {
      if (now - at > RETENTION_SWEEP_INTERVAL_MS * 2) lastRetentionSweepAt.delete(id);
    }
  }

  after(async () => {
    try {
      await supabase.rpc("cleanup_old_transactions_for_store", { p_store_id: storeId });
    } catch (e) {
      console.warn("[API] Retention sweep failed (non-fatal):", e);
    }
  });
}

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

    // Two independent lookups, one wave.
    //
    // These used to be serial: resolve the caller, then fetch the store's
    // retention settings, then run the actual query — three round trips deep
    // before a single transaction was read, on an endpoint measured at
    // 700-2,700 ms. Neither of the first two reads what the other writes, and
    // the settings fetch is scoped by `store_id` from the header, which the
    // permission check below governs the USE of, not the fetch. So they go
    // together and the depth drops to two.
    //
    // The permission gate itself is unchanged and still runs before anything
    // is returned: hiding the History link is not a guard, and a cashier with
    // transactions:false who knows this URL used to get every sale in the
    // store.
    const [caller, { data: store, error: storeError }] = await Promise.all([
      resolveCaller(supabase, store_id, readAuthHeader(request).userId),
      supabase
        .from("stores")
        .select("transaction_retention_days, max_transactions")
        .eq("id", store_id)
        .single(),
    ]);

    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canAccessSection(caller, "transactions")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
          currency,
          modifiers,
          note,
          combo_children
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

    // ── Which cash drawer did this sale go into? ────────────────────────────
    //
    // Resolved from WHO rang the sale, not from the device it was rung on.
    //
    // The supervisor opens a shift on a register and assigns a cashier to it;
    // everything that cashier sells while it is open belongs to that shift, and
    // through it to that register. Nothing has to be configured on the till —
    // which matters because a POS-only cashier cannot reach the cash page, and
    // a per-device setting could not be administered from the supervisor's own
    // machine anyway.
    //
    // The match is on the sale's OWN timestamp, not on "what is open right
    // now". That is what keeps offline sales honest: a sale rung during Ali's
    // morning shift and synced after it closed still lands on the morning
    // shift rather than on whoever is at that drawer by then.
    //
    // Best-effort throughout. A sale is NEVER failed or delayed because of
    // cash-register state — an unresolved sale simply carries a null shift_id
    // and appears in the Unassigned bucket on the cash page for the supervisor
    // to notice.
    let resolvedShiftId: string | null = null;
    let resolvedRegisterId: string | null = null;

    try {
      const at = saleTime || new Date().toISOString();
      const operatorId = typeof body.user_id === "string" && body.user_id ? body.user_id : null;

      let shiftQuery = supabase
        .from("cash_shifts")
        .select("id, register_id")
        .eq("store_id", store_id)          // tenancy: never resolve into another store's shift
        .lte("opened_at", at)
        .or(`closed_at.is.null,closed_at.gte.${at}`)
        .order("opened_at", { ascending: false })
        .limit(1);

      // An employee matches their own assignment; the store owner has no
      // store_users row, so they are represented by the assigned_to_owner flag.
      shiftQuery = operatorId
        ? shiftQuery.eq("assigned_user_id", operatorId)
        : shiftQuery.eq("assigned_to_owner", true);

      const { data: matchingShift } = await shiftQuery.maybeSingle();

      if (matchingShift) {
        resolvedShiftId = matchingShift.id;
        resolvedRegisterId = matchingShift.register_id;
      }
    } catch (shiftErr) {
      console.error(
        "[API] Shift resolution failed, recording sale unassigned:",
        shiftErr instanceof Error ? shiftErr.message : shiftErr
      );
    }

    // NO duplicate pre-check.
    //
    // There used to be a `select id where transaction_number = ...` here on
    // 100% of sales, to catch the sync engine pushing the same queued sale
    // twice. It was a full extra round trip on the money path to answer a
    // question the database already answers for free: idempotency comes from
    // the UNIQUE (store_id, transaction_number) constraint added in migration
    // 016, and the 23505 branch below returns exactly the same
    // `{ transaction, duplicated: true }` response the pre-check did. The
    // insert is attempted and rejected instead of being pre-empted, which is
    // one round trip rather than two on every sale in the shop.
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
        // Cash drawer attribution. Both nullable and both derived from the
        // resolved shift — a sale with no shift has no register either, and
        // lands in the Unassigned bucket.
        ...(resolvedShiftId && { shift_id: resolvedShiftId }),
        ...(resolvedRegisterId && { register_id: resolvedRegisterId }),
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
          currency,
          modifiers,
          note,
          combo_children
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
        // `?? null`, never `|| null`: [] is meaningful (a menu line with
        // nothing changed) and is what the kitchen board filters tickets on.
        modifiers: item.modifiers ?? null,
        note: item.note ?? null,
        combo_children: item.combo_children ?? null,
      }));

      // CRITICAL FIX: Decrement stock server-side for each item.
      // This ensures stock is decremented exactly once per transaction,
      // whether the transaction was created online or synced from offline.
      // Uses the service role client (bypasses RLS) so the RPC works reliably.
      //
      // ## Where the list comes from
      //
      // The client sends `stock_decrements` when it knows better than `items`
      // does — a made-to-order line consumes its INGREDIENTS, and `items` only
      // names the sandwich. It is computed on the client because the recipe AT
      // THE TIME OF SALE is the right one: a sandwich sold offline on Monday
      // and synced Wednesday must deduct what Monday's recipe said.
      //
      // The `else` branch is the COMPATIBILITY HINGE and must not be removed.
      // It reproduces exactly today's behaviour for: every ordinary sale, every
      // sale already sitting in a device's offline_queue, and any client that
      // has not updated yet.
      //
      // This does not widen the attack surface — the client already dictates
      // `items`, which already drives these decrements, through the same
      // unsigned header (audit P0-1). decrement_stock's p_store_id makes a
      // foreign product_id a no-op UPDATE.
      type Decrement = { product_id: string; quantity: number };
      const isValidDecrement = (value: unknown): value is Decrement => {
        if (!value || typeof value !== "object") return false;
        const d = value as Record<string, unknown>;
        const quantity = Number(d.quantity);
        return (
          typeof d.product_id === "string" &&
          Number.isFinite(quantity) &&
          quantity > 0
        );
      };

      const decrements: Decrement[] = Array.isArray(body.stock_decrements)
        ? (body.stock_decrements as unknown[]).filter(isValidDecrement)
        : (body.items as Array<{ product_id: string | null; quantity: number }>)
            .filter((item) => !!item.product_id)
            .map((item) => ({
              product_id: item.product_id as string,
              quantity: item.quantity,
            }));

      // ## Two waves, not N+1 serial round trips
      //
      // The line items and the stock decrements are independent of each other —
      // neither reads what the other writes — so they go out together. And the
      // decrements go as ONE `decrement_stock_batch` call rather than a
      // `decrement_stock` per line: a ten-line sale used to be ten serial
      // round trips from the Vercel function to Postgres, and a made-to-order
      // sale is worse than that because a sandwich decrements every ingredient
      // in its recipe. That whole loop is now one call.
      //
      // `decrement_stock_batch` is from migration 037. If it has not been
      // applied yet the call fails with PostgREST's "function not found"
      // (PGRST202 / 42883) and we fall back to the original per-item loop, so
      // this deploy is safe in either order.
      const insertItems = supabase.from("transaction_items").insert(txnItems);

      const applyDecrements = async () => {
        if (decrements.length === 0) return;

        const { error: batchError } = await supabase.rpc("decrement_stock_batch", {
          p_store_id: store_id,
          p_items: decrements,
        });

        if (!batchError) return;

        const missing =
          batchError.code === "PGRST202" ||
          batchError.code === "42883" ||
          /could not find the function|does not exist/i.test(batchError.message || "");

        if (!missing) {
          console.error("[API] Batch stock decrement failed:", batchError);
          return;
        }

        console.warn(
          "[API] decrement_stock_batch not available (migration 037 not applied?) — falling back to per-item decrements"
        );
        for (const decrement of decrements) {
          const { error: stockError } = await supabase.rpc("decrement_stock", {
            product_id: decrement.product_id,
            quantity: decrement.quantity,
            p_store_id: store_id,
          });

          if (stockError) {
            console.error(`[API] Stock decrement failed for product ${decrement.product_id}:`, stockError);
            // Don't fail the transaction — log and continue.
            // The transaction is already created; stock can be reconciled later.
          }
        }
      };

      const [{ error: itemsError }] = await Promise.all([insertItems, applyDecrements()]);

      if (itemsError) {
        console.error("Transaction items error:", itemsError);
        // Transaction created but items failed - still return success but log error
      }
    }

    // Retention, moved OFF the sale path.
    //
    // Migration 012 did this with an AFTER INSERT ... FOR EACH ROW trigger that
    // ran a COUNT(*) over the store's whole transaction table plus two DELETEs
    // inside the transaction that takes the customer's money. Migration 037
    // drops it; this is where the same policy runs instead — at most once an
    // hour per server instance, and via `after()` so it happens once the
    // response has already gone back to the till. Same pattern
    // POST /api/activity uses for its partition maintenance.
    //
    // A failure here is never surfaced: retention falling behind is a disk
    // concern, and the sale is already recorded.
    maybeRunRetentionCleanup(supabase, store_id);

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
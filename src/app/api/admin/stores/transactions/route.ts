// =============================================
// Transaction retention: health figures and the manual cleanup.
//
// /admin/transactions used to read `store_transaction_health` and call the
// `cleanup_old_transactions_for_store` RPC straight from the browser. The RPC
// DELETES a store's sales history, so it was a destructive cross-tenant
// operation reachable by anyone holding the public key — which is everyone
// with the bundle.
//
// The retention SETTINGS are written by PATCH /api/admin/stores, not here, so
// the `stores` table keeps a single writer on the admin side.
//
// Both verbs are gated on `requireAdmin()`.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/adminSession";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/stores/transactions?store_id=… — retention settings + health
export async function GET(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof NextResponse) return session;

  try {
    const storeId = new URL(request.url).searchParams.get("store_id");
    if (!storeId || !UUID_RE.test(storeId)) {
      return NextResponse.json({ error: "store_id must be a UUID" }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    // `store_transaction_health` is a view that COUNTs and MINs/MAXes in
    // Postgres (migration 011). The row count never crosses the wire, so this
    // is the aggregate-in-the-database rule already satisfied — do not
    // "simplify" it into selecting transactions and counting them here.
    const [settings, health] = await Promise.all([
      supabase
        .from("stores")
        .select("username, transaction_retention_days, max_transactions")
        .eq("id", storeId)
        .single(),
      supabase
        .from("store_transaction_health")
        .select(
          "current_transaction_count, oldest_transaction, newest_transaction, estimated_size, status"
        )
        .eq("store_id", storeId)
        .single(),
    ]);

    if (settings.error || !settings.data) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    return NextResponse.json({
      store: { id: storeId, username: settings.data.username },
      settings: {
        transaction_retention_days: settings.data.transaction_retention_days ?? 90,
        max_transactions: settings.data.max_transactions ?? 5000,
      },
      // A store that has never sold anything has no health row. That is not an
      // error — the page renders "no transaction data".
      health: health.error ? null : health.data,
    });
  } catch (error) {
    console.error("Error fetching transaction health:", error);
    return NextResponse.json({ error: "Failed to load transaction settings" }, { status: 500 });
  }
}

// POST /api/admin/stores/transactions — run the cleanup for one store
export async function POST(request: Request) {
  const session = await requireAdmin(request);
  if (session instanceof NextResponse) return session;

  try {
    const body = await request.json();
    const storeId = typeof body.store_id === "string" ? body.store_id : "";

    if (!UUID_RE.test(storeId)) {
      return NextResponse.json({ error: "store_id must be a UUID" }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    // Deletes sales rows according to that store's own retention settings. The
    // store id is explicit and required: there is no "current store" default,
    // because a defaulted tenant on a delete is how the wrong shop's history
    // goes.
    const { data, error } = await supabase.rpc("cleanup_old_transactions_for_store", {
      p_store_id: storeId,
    });

    if (error) {
      console.error("Transaction cleanup failed:", error.code, error.message);
      return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
    }

    const result = (data ?? {}) as { deleted_count?: number; reason?: string };

    return NextResponse.json({
      deleted: result.deleted_count ?? 0,
      reason: result.reason ?? "completed",
    });
  } catch (error) {
    console.error("Transaction cleanup failed:", error);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

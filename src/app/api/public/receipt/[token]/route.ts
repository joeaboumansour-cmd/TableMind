import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { isValidReceiptToken } from "@/lib/receipt/token";

// Simple in-memory rate limiting: max 30 requests per token per minute.
// This prevents brute-force scraping of the public receipt endpoint.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(token: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(token);
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(token, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

/**
 * Public receipt endpoint — NO AUTH REQUIRED.
 *
 * Looks up a transaction by its unguessable receipt_token only.
 * Never accepts store_id or transaction_number (both are guessable).
 *
 * Returns only safe fields:
 *  - Store name + contact info (phone/whatsapp, address) for marketing
 *  - Transaction number, date
 *  - Line items: product name + quantity ONLY (no unit prices)
 *  - Total, amount paid, change
 *
 * No user info, no store_id, no internal data.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Validate token format early
    if (!isValidReceiptToken(token)) {
      return NextResponse.json({ error: "Invalid receipt" }, { status: 404 });
    }

    // Rate limit per token
    if (isRateLimited(token)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Check Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Receipt service unavailable" },
        { status: 503 }
      );
    }

    const supabase = await createServiceRoleClient();

    // Look up transaction by receipt_token ONLY
    const { data: transaction, error } = await supabase
      .from("transactions")
      .select(`
        id,
        transaction_number,
        total_amount,
        amount_paid,
        change_given,
        created_at,
        store_id,
        stores (
          username,
          phone_whatsapp,
          address
        ),
        transaction_items (
          id,
          product_name,
          quantity
        )
      `)
      .eq("receipt_token", token)
      .maybeSingle();

    if (error) {
      console.error("[PublicReceipt] Query error:", error);
      return NextResponse.json({ error: "Failed to load receipt" }, { status: 500 });
    }

    if (!transaction) {
      // Not found — could be a pending offline transaction not yet synced.
      return NextResponse.json(
        { error: "Receipt not found", pending: true },
        { status: 404 }
      );
    }

    // Build the safe public response
    const store = transaction.stores as any;
    return NextResponse.json({
      receipt: {
        transaction_number: transaction.transaction_number,
        created_at: transaction.created_at,
        total_amount: transaction.total_amount,
        amount_paid: transaction.amount_paid,
        change_given: transaction.change_given || 0,
        items: (transaction.transaction_items || []).map((item: any) => ({
          product_name: item.product_name,
          quantity: item.quantity,
        })),
        store: {
          name: store?.username || "Store",
          phone_whatsapp: store?.phone_whatsapp || null,
          address: store?.address || null,
        },
      },
    });
  } catch (error: any) {
    console.error("[PublicReceipt] Error:", error);
    return NextResponse.json(
      { error: "Failed to load receipt" },
      { status: 500 }
    );
  }
}
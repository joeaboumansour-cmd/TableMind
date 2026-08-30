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
 *  - Exact subtotal + cash rounding adjustment (so the receipt math always
 *    reconciles: subtotal + rounding adjustment = total)
 *  - Line items: product name + quantity + unit price + line total
 *  - Total, amount paid, change
 *
 * No user info, no store_id, no internal data.
 *
 * Rounding note: prices are stored EXACT (unrounded). Only the final total is
 * rounded to the nearest 5,000 LL (smallest cash denomination). The
 * "rounding adjustment" line on the receipt exposes this delta so the customer
 * sees exactly how subtotal → total, preventing "why doesn't it add up?"
 * skepticism. The store absorbs at most ±2,500 LL per transaction regardless
 * of quantity, so there is no per-unit rounding loss.
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
        subtotal,
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
          quantity,
          unit_price,
          total_price,
          currency,
          modifiers,
          note,
          combo_children
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

    // Coerce monetary values to numbers. Supabase may return DECIMAL columns
    // as numbers or numeric strings depending on driver config, so normalise
    // here so the receipt page never has to guess.
    const subtotal = transaction.subtotal != null ? Number(transaction.subtotal) : 0;
    const totalAmount = Number(transaction.total_amount);

    return NextResponse.json({
      receipt: {
        transaction_number: transaction.transaction_number,
        created_at: transaction.created_at,
        subtotal,
        total_amount: totalAmount,
        amount_paid: transaction.amount_paid,
        change_given: transaction.change_given || 0,
        // Delta between the exact subtotal and the cash-rounded total.
        // Always reconciles: subtotal + rounding_adjustment = total_amount.
        rounding_adjustment: totalAmount - subtotal,
        items: (transaction.transaction_items || []).map((item: any) => ({
          product_name: item.product_name,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          total_price: Number(item.total_price) || 0,
          currency: (item.currency as "LL" | "USD") || "LL",
          // Null on every ordinary line; the receipt renders nothing for it.
          modifiers: item.modifiers ?? null,
          note: item.note ?? null,
          combo_children: item.combo_children ?? null,
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
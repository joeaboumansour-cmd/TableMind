// =============================================================================
// POST /api/products — upsert a product
//
// Products were previously written straight from the browser with the Supabase
// client, which meant a product create/update simply FAILED with no internet.
// The till needs to be able to name and price an unknown barcode during an
// outage, so the write has to go through a route the sync engine can replay.
//
// Idempotency: the id is generated on the CLIENT and this is an UPSERT on it.
// A queued write that is pushed twice (a lost response, two tabs syncing)
// therefore converges instead of creating a duplicate product.
//
// ⚠️ AUTH: this reads tenancy from the unsigned `x-auth-data` header, matching
// every other route the POS client can call. That pattern is the known P0-1
// vulnerability and is being replaced by `src/lib/auth/jwt.ts`. It is used here
// only because the client has no token to send yet — switching this route
// alone would make the feature unusable. Everything else the api-route skill
// asks for IS done: every field is validated, and the write is scoped by the
// store_id from the header rather than anything in the body.
// =============================================================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * DECIMAL(14,2) after migration 025. Amounts are in Lebanese Pounds, where a
 * single item is routinely ~185,000, so the old DECIMAL(10,2) ceiling of
 * 99,999,999.99 was reachable. Reject anything the column cannot hold rather
 * than letting Postgres throw mid-write.
 */
const MAX_MONEY = 999_999_999_999.99;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Postgres error as PostgREST surfaces it. */
interface PgError {
  code?: string;
  message?: string;
}

/** Parsed JSON body: unknown shape until validated. */
type JsonBody = Record<string, unknown>;

/** Message from an unknown thrown value, without widening to `any`. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


interface Validated {
  id: string;
  store_id: string;
  name: string;
  barcode: string | null;
  cost_price: number;
  selling_price: number;
  currency: "LL" | "USD";
  profit_percentage: number;
  discount_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
  category_id: string | null;
  kind: string;
  stock_unit: string;
  serving_qty: number;
}

function readStoreId(request: Request): string | null {
  const authData = request.headers.get("x-auth-data");
  if (!authData) return null;
  try {
    const parsed = JSON.parse(authData);
    return typeof parsed?.store_id === "string" && parsed.store_id ? parsed.store_id : null;
  } catch {
    return null;
  }
}

/** Finite, non-negative, and inside the column's range. */
function money(value: unknown, field: string): number | string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `${field} must be a number`;
  if (n < 0) return `${field} must not be negative`;
  if (n > MAX_MONEY) return `${field} is too large`;
  return n;
}

/**
 * A real 0-100 percentage. Only `discount_percentage` is one of these: you
 * cannot take more than all of the price off, or a negative amount off.
 */
function boundedPercentage(value: unknown, field: string): number | string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `${field} must be a number`;
  if (n < 0 || n > 100) return `${field} must be between 0 and 100`;
  return n;
}

/**
 * `profit_percentage` is DERIVED, and the database owns it.
 *
 * A trigger recomputes it on every insert and update:
 *   NEW.profit_percentage = ((NEW.selling_price - NEW.cost_price) / NEW.cost_price) * 100
 * (migrations 005/009; verified live — all 3,336 costed rows match the formula
 * exactly, and every zero-cost row is 0).
 *
 * So whatever the client sends here is overwritten. Rejecting a product save
 * because of this field gates a write on something the server ignores, which
 * is exactly how a cashier ended up unable to save a price: first because a
 * 300% markup failed a 0-100 check, then because a near-zero cost produced a
 * markup outside an arbitrary ceiling.
 *
 * It is therefore CLAMPED, never rejected — a sane fallback in case the
 * trigger is ever dropped, and never a reason to refuse the write.
 * DECIMAL(10,2) after migration 025, so the column holds +/-99,999,999.99.
 */
const MAX_PROFIT_PCT = 99_999_999.99;

function clampProfit(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_PROFIT_PCT, Math.min(MAX_PROFIT_PCT, n));
}

function wholeNumber(value: unknown, field: string): number | string {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n)) return `${field} must be a whole number`;
  // Stock can legitimately go negative through a race between an offline sale
  // and a stock take, so this one is not sign-checked. The column is int32.
  if (Math.abs(n) > 2_000_000_000) return `${field} is out of range`;
  return n;
}

function validate(body: JsonBody | null, storeId: string): Validated | string {
  if (!body || typeof body !== "object") return "Body must be an object";

  const id = body.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return "id must be a UUID generated by the client";
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return "name is required";
  if (name.length > 200) return "name is too long";

  let barcode: string | null = null;
  if (body.barcode !== null && body.barcode !== undefined && body.barcode !== "") {
    if (typeof body.barcode !== "string") return "barcode must be a string";
    const trimmed = body.barcode.trim();
    if (trimmed.length > 64) return "barcode is too long";
    barcode = trimmed || null;
  }

  const currency = body.currency === "USD" ? "USD" : "LL";

  const cost = money(body.cost_price, "cost_price");
  if (typeof cost === "string") return cost;
  const selling = money(body.selling_price, "selling_price");
  if (typeof selling === "string") return selling;
  const profit = clampProfit(body.profit_percentage);
  const discount = boundedPercentage(body.discount_percentage, "discount_percentage");
  if (typeof discount === "string") return discount;
  const stock = wholeNumber(body.stock_quantity, "stock_quantity");
  if (typeof stock === "string") return stock;
  const minStock = wholeNumber(body.min_stock_threshold, "min_stock_threshold");
  if (typeof minStock === "string") return minStock;

  // The database enforces that the category belongs to THIS store, via the
  // composite FK (category_id, store_id) added in migration 029 — so there is
  // no ownership lookup to pay for here. A category from another tenant fails
  // the insert rather than being silently accepted.
  let categoryId: string | null = null;
  if (body.category_id !== null && body.category_id !== undefined && body.category_id !== "") {
    if (typeof body.category_id !== "string" || !UUID_RE.test(body.category_id)) {
      return "category_id must be a UUID";
    }
    categoryId = body.category_id;
  }

  // Anything that is not explicitly 'ingredient' is sellable. Defaulting the
  // other way would let a malformed write hide a product from the till.
  const kind = body.kind === "ingredient" ? "ingredient" : "sellable";

  let stockUnit = "unit";
  if (body.stock_unit !== null && body.stock_unit !== undefined && body.stock_unit !== "") {
    if (typeof body.stock_unit !== "string") return "stock_unit must be a string";
    const trimmed = body.stock_unit.trim();
    if (trimmed.length > 16) return "stock_unit is too long";
    if (trimmed) stockUnit = trimmed;
  }

  // One portion of an ingredient, in its own stock_unit. Must be positive —
  // a zero or negative serving would deduct nothing or ADD stock on a sale.
  let servingQty = 1;
  if (body.serving_qty !== null && body.serving_qty !== undefined && body.serving_qty !== "") {
    const n = Number(body.serving_qty);
    if (!Number.isFinite(n) || n <= 0) return "serving_qty must be greater than zero";
    if (n > 1_000_000) return "serving_qty is out of range";
    servingQty = n;
  }

  return {
    id,
    // From the header, never from the body — the caller does not get to pick
    // which tenant they are writing into.
    store_id: storeId,
    name,
    barcode,
    cost_price: cost,
    selling_price: selling,
    currency,
    profit_percentage: profit,
    discount_percentage: discount,
    stock_quantity: stock,
    min_stock_threshold: minStock,
    category_id: categoryId,
    kind,
    stock_unit: stockUnit,
    serving_qty: servingQty,
  };
}

export async function POST(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
    }

    const storeId = readStoreId(request);
    if (!storeId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: JsonBody;
    try {
      body = (await request.json()) as JsonBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validated = validate(body, storeId);
    if (typeof validated === "string") {
      return NextResponse.json({ error: validated }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    // Guard against writing over ANOTHER store's product: the id is chosen by
    // the client, so without this a forged id could overwrite a neighbour's
    // catalogue row. 404 rather than 403 — do not confirm that an id belonging
    // to someone else exists.
    const { data: existing, error: lookupError } = await supabase
      .from("products")
      .select("id, store_id")
      .eq("id", validated.id)
      .maybeSingle();

    if (lookupError) {
      console.error("[API] Product lookup failed:", lookupError.message);
      return NextResponse.json({ error: "Failed to save product" }, { status: 500 });
    }
    if (existing && existing.store_id !== storeId) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("products")
      .upsert(validated, { onConflict: "id" })
      .select()
      .single();

    if (error) {
      // A barcode collision inside the same store is a real conflict the
      // cashier can act on, not a server fault.
      if ((error as PgError).code === "23505") {
        return NextResponse.json(
          { error: "A product with this barcode already exists in your store" },
          { status: 409 }
        );
      }
      console.error("[API] Product upsert failed:", error.message);
      return NextResponse.json({ error: "Failed to save product" }, { status: 500 });
    }

    return NextResponse.json({ product: data }, { status: 200 });
  } catch (error: unknown) {
    console.error("[API] /api/products error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to save product" }, { status: 500 });
  }
}

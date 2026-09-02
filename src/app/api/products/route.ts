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

// =============================================================================
// GET /api/products — read this store's catalogue
//
// The browser used to read `products` STRAIGHT from Supabase with the public
// key, which is why every till had to hold a key that could read the whole
// database. This is that read, moved behind the server so the public key can
// be swapped for a real anon key.
//
// ONE endpoint with a `fields` mode rather than three routes: the full pull,
// the reconcile's ID sweep and the exact count are the same query with a
// different column list, and the reconcile guard is only sound when all three
// are scoped to the SAME tenant by the SAME code. Splitting them would
// duplicate the auth and the store scoping, which is exactly where a scoping
// bug hides.
//
//   ?fields=full  (default)  -> { products: ProductRow[] }   PRODUCT_COLUMNS
//   ?fields=id               -> { ids: string[] }            for reconcile
//   ?fields=count            -> { count: number }            exact, head-only
//   ?barcode=<code>          -> { products: ProductRow[] }   0 or 1 row
//
//   &limit=<1..1000>  &offset=<n>   paging (full and id modes)
//   &since=<iso>                    delta watermark (full mode)
//
// ⚠️ PAGING IS LOAD-BEARING. PostgREST caps ANY read at 1,000 rows, so the
// client pages with .range() and stops on a SHORT page. That means this route
// must never return fewer rows than asked for while more exist in the window —
// a silently trimmed page reads to the client as "end of catalogue", and an
// ID list truncated that way tells reconcileProductsCache() that everything
// past row 1,000 was deleted. `limit` above the ceiling is therefore REJECTED
// rather than clamped: a clamped limit is the `.limit(5000)` bug that shipped
// in /api/recipes.
//
// ⚠️ AUTH: `resolveCaller()`, so tenancy is looked up server-side and the
// caller cannot name a store. There is deliberately NO section-permission gate:
// the catalogue feeds both /pos and /pos/products, and a caller whose
// permissions blob failed to parse would get an empty till rather than a denied
// screen. Authentication + store scoping is what closes the hole here; the
// section gates stay where they already are, on the screens.
// =============================================================================

import { readAuthHeader, resolveCaller } from "@/lib/auth/apiCaller";
import { PRODUCT_COLUMNS } from "@/lib/products/columns";

/** PostgREST's hard ceiling. A page larger than this is silently trimmed. */
const MAX_PAGE = 1000;

/** A positive integer query param, or a message describing why it is not. */
function intParam(raw: string | null, field: string, fallback: number, max: number): number | string {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return `${field} must be a non-negative integer`;
  if (n > max) return `${field} must not exceed ${max}`;
  return n;
}

export async function GET(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase is not configured" }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);

    const fields = searchParams.get("fields") || "full";
    if (fields !== "full" && fields !== "id" && fields !== "count") {
      return NextResponse.json({ error: "fields must be full, id or count" }, { status: 400 });
    }

    // Rejected, never clamped — see the paging note above.
    const limit = intParam(searchParams.get("limit"), "limit", MAX_PAGE, MAX_PAGE);
    if (typeof limit === "string") return NextResponse.json({ error: limit }, { status: 400 });
    if (limit === 0) return NextResponse.json({ error: "limit must be at least 1" }, { status: 400 });

    const offset = intParam(searchParams.get("offset"), "offset", 0, 10_000_000);
    if (typeof offset === "string") return NextResponse.json({ error: offset }, { status: 400 });

    const since = searchParams.get("since");
    if (since !== null && Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: "since must be an ISO timestamp" }, { status: 400 });
    }

    const barcode = searchParams.get("barcode");
    if (barcode !== null && (barcode.length === 0 || barcode.length > 64)) {
      return NextResponse.json({ error: "barcode is out of range" }, { status: 400 });
    }

    const supabase = await createServiceRoleClient();

    const { storeId, userId } = readAuthHeader(request);
    const caller = await resolveCaller(supabase, storeId, userId);
    if (!caller) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Exact count ───────────────────────────────────────────────────────
    // head-only, so no rows cross the wire. This is the "positive proof" half
    // of evaluateReconcile(): the client compares it against the number of IDs
    // it managed to fetch and refuses to delete anything if they disagree.
    if (fields === "count") {
      const { count, error } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId);

      if (error || count === null || count === undefined) {
        return NextResponse.json({ error: "Failed to count products" }, { status: 500 });
      }
      return NextResponse.json({ count });
    }

    let query = supabase
      .from("products")
      .select(fields === "id" ? "id" : PRODUCT_COLUMNS)
      // Tenancy from the RESOLVED caller's store, never from the query string.
      .eq("store_id", storeId);

    if (barcode !== null) {
      // A single exact lookup — the till's fallback for a code that has not
      // reached this device's cache yet. Paging is irrelevant to it.
      const { data, error } = await query.eq("barcode", barcode).limit(1);
      if (error) {
        console.error("[API] Product barcode lookup failed:", error.message);
        return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
      }
      return NextResponse.json({ products: data ?? [] });
    }

    if (fields === "id") {
      // Ordered by the primary key — unique, so pages cannot skip or repeat.
      query = query.order("id");
    } else if (since !== null) {
      // updated_at alone is not unique: a bulk reprice stamps hundreds of rows
      // at the same NOW(). Tiebreak on id or pages skip rows.
      query = query.gte("updated_at", since).order("updated_at").order("id");
    } else {
      query = query.order("name").order("id");
    }

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      console.error("[API] Product read failed:", error.message);
      return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
    }

    const rows = data ?? [];

    if (fields === "id") {
      return NextResponse.json({ ids: rows.map((r) => (r as unknown as { id: string }).id) });
    }
    return NextResponse.json({ products: rows });
  } catch (error: unknown) {
    console.error("[API] GET /api/products error:", errorMessage(error));
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}

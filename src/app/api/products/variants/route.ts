// =============================================
// POST /api/products/variants — the extra barcodes attached to one product
// =============================================
//
// A "variant" is a second barcode for the same item (a different size on the
// same rail, a re-labelled carton). It is a `products` row with `parent_id`
// set, a `variant_name`, and no price or stock of its own — the parent carries
// those.
//
// It needs its own route because `POST /api/products` is the single-product
// upsert used by `src/lib/products/write.ts`, and it deliberately does not
// accept `parent_id` or `variant_name`. Pushing variants through it would turn
// each one into a standalone zero-priced product with the parent's name, which
// is worse than the browser write it replaces.
//
// The Inventory form used to insert these straight from the BROWSER with the
// public Supabase client — one of the writes keeping a `service_role` key in
// the bundle.
//
// ## What the client may set
//
// Only the id, the barcode and the variant name. Price, cost, stock and
// `profit_percentage` are fixed at zero HERE rather than accepted from the
// body: a variant that arrived with a price of its own would be sellable at
// that price, and the form has no field for one.
//
// ## Idempotency
//
// The ids are generated on the client and this is an UPSERT on them, matching
// `POST /api/products`. A retried submit converges instead of duplicating the
// rail.
//
// ## Auth and tenancy
//
// `resolveCaller()` plus the `inventory` section — the permission that gates
// everything deciding what a customer is charged. `store_id` comes from the
// caller, and the parent is re-read under that same scope, so a forged
// `parent_id` cannot attach a variant to another tenant's product.
//
// `x-auth-data` is still an unsigned client header (audit P0-1).
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller, canAccessSection } from "@/lib/auth/apiCaller";
import { bad } from "@/lib/auth/apiRoute";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres: a unique index rejected the row. */
const UNIQUE_VIOLATION = "23505";

/** One product's rail. Well past anything a shop enters by hand. */
const MAX_VARIANTS = 200;

interface VariantRow {
  id: string;
  store_id: string;
  parent_id: string;
  name: string;
  barcode: string;
  variant_name: string | null;
  cost_price: number;
  selling_price: number;
  currency: "LL" | "USD";
  profit_percentage: number;
  discount_percentage: number;
  stock_quantity: number;
  min_stock_threshold: number;
}

export async function POST(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return bad("Supabase is not configured", 500);
  }

  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  const caller = await resolveCaller(supabase, storeId, userId);
  if (!caller) return bad("Unauthorized", 401);
  if (!canAccessSection(caller, "inventory")) return bad("Forbidden", 403);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const parentId = typeof body.parent_id === "string" ? body.parent_id : "";
  if (!UUID_RE.test(parentId)) return bad("parent_id must be a UUID", 400);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return bad("name is required", 400);
  if (name.length > 200) return bad("name is too long", 400);

  const currency: "LL" | "USD" = body.currency === "USD" ? "USD" : "LL";

  const minStock = Number(body.min_stock_threshold ?? 0);
  if (!Number.isInteger(minStock) || Math.abs(minStock) > 2_000_000_000) {
    return bad("min_stock_threshold must be a whole number", 400);
  }

  if (!Array.isArray(body.variants)) return bad("variants must be an array", 400);
  if (body.variants.length === 0) return NextResponse.json({ saved: 0 });
  if (body.variants.length > MAX_VARIANTS) return bad("Too many variants in one request", 400);

  const rows: VariantRow[] = [];
  for (const entry of body.variants as unknown[]) {
    const variant = (entry ?? {}) as Record<string, unknown>;

    const id = typeof variant.id === "string" ? variant.id : "";
    if (!UUID_RE.test(id)) return bad("each variant needs a client-generated UUID id", 400);

    // A variant with no barcode is the only thing distinguishing it from its
    // parent, so it is not a variant. The form already filters these out.
    const barcode = typeof variant.barcode === "string" ? variant.barcode.trim() : "";
    if (!barcode) return bad("each variant needs a barcode", 400);
    if (barcode.length > 64) return bad("barcode is too long", 400);

    let variantName: string | null = null;
    if (typeof variant.variant_name === "string" && variant.variant_name.trim()) {
      variantName = variant.variant_name.trim().slice(0, 200);
    }

    rows.push({
      id,
      store_id: storeId,
      parent_id: parentId,
      name,
      barcode,
      variant_name: variantName,
      // Fixed here, not read from the body — see the header comment.
      cost_price: 0,
      selling_price: 0,
      currency,
      profit_percentage: 0,
      discount_percentage: 0,
      stock_quantity: 0,
      min_stock_threshold: minStock,
    });
  }

  // The parent must exist AND be this store's. 404 rather than 403 — do not
  // confirm that an id belonging to someone else exists.
  const { data: parent, error: parentError } = await supabase
    .from("products")
    .select("id")
    .eq("id", parentId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (parentError) {
    console.error("[Variants] Parent lookup failed:", parentError.message);
    return bad("Failed to save variants", 500);
  }
  if (!parent) return bad("Product not found", 404);

  const { error } = await supabase.from("products").upsert(rows, { onConflict: "id" });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return bad("A product with one of these barcodes already exists in your store", 409);
    }
    console.error("[Variants] Upsert failed:", error.message);
    return bad("Failed to save variants", 500);
  }

  return NextResponse.json({ saved: rows.length });
}

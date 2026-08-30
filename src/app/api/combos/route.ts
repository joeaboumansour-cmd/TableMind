// =============================================
// /api/combos — what a meal is made of
// =============================================
// GET  every combo in the store, in one shot (the till caches the lot)
// PUT  replace ONE combo's contents wholesale
//
// Same shape and the same reasoning as /api/recipes: the editor works on a
// whole combo at a time, and "delete the ones that went, insert the ones that
// arrived, update the rest" is three ways to get a half-saved meal.
//
// Reads are open to any authenticated caller because the till needs combos to
// sell. Writes need `inventory` — a combo decides what a customer is charged.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller, canAccessSection } from "@/lib/auth/apiCaller";
import {
  MAX_COMBO_ITEMS,
  validateComboComponent,
  type ComboComponent,
  type ComboComponentInput,
  type ComboMap,
} from "@/lib/combos/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FK_VIOLATION = "23503";
const SELECT_COLS = "id, combo_product_id, item_product_id, quantity, sort_order";

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireCaller(request: Request, write: boolean) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }
  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  const caller = await resolveCaller(supabase, storeId, userId);
  if (!caller) return { error: bad("Unauthorized", 401) };
  if (write && !canAccessSection(caller, "inventory")) return { error: bad("Forbidden", 403) };
  return { supabase, storeId };
}

/**
 * Resolve the caller and run a store-scoped read CONCURRENTLY.
 *
 * `requireCaller` is a sequential gate: resolve who is calling, then query.
 * That is two full round trips deep before a byte of data is read, on routes
 * the POS fires three of at once on launch. Neither step reads what the other
 * writes, and the query is already scoped to the `store_id` the caller is
 * claiming — so a failed auth discards a read of the caller's OWN store and
 * never touches another tenant.
 *
 * This is the same trade GET /api/cash-shifts already makes (see its "Wave 1"
 * comment): overlap the latency, decide afterwards, return nothing until the
 * caller is confirmed.
 */
type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;
type ResolvedCaller = NonNullable<Awaited<ReturnType<typeof resolveCaller>>>;

async function callerAndRead<T>(
  request: Request,
  read: (supabase: ServiceClient, storeId: string) => PromiseLike<T>
): Promise<
  { error: NextResponse } | { caller: ResolvedCaller; storeId: string; result: T }
> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }
  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  if (!storeId) return { error: bad("Unauthorized", 401) };

  // Promise.resolve() so the PostgREST builder (a thenable, not a Promise) is
  // a real Promise before Promise.all sees it — otherwise T infers as unknown.
  const readPromise: Promise<T> = Promise.resolve(read(supabase, storeId));
  const [caller, result] = await Promise.all([
    resolveCaller(supabase, storeId, userId),
    readPromise,
  ]);

  if (!caller) return { error: bad("Unauthorized", 401) };
  return { caller, storeId, result };
}

// ── GET ────────────────────────────────────────────────────────────────────
// Explicit cap: PostgREST silently truncates an unbounded select at 1000, and
// a truncated combo would sell a meal missing half its contents.
const COMBO_CAP = 2000;

export async function GET(request: Request) {
  const resolved = await callerAndRead(request, (supabase, storeId) =>
    supabase
      .from("combo_components")
      .select(SELECT_COLS)
      .eq("store_id", storeId)
      .order("sort_order", { ascending: true })
      .limit(COMBO_CAP)
  );
  if ("error" in resolved) return resolved.error;
  const { data, error } = resolved.result;
  const CAP = COMBO_CAP;

  if (error) {
    console.error("[Combos] List failed:", error.message);
    return bad("Could not load combos", 500);
  }

  const rows = (data || []) as ComboComponent[];
  const combos: ComboMap = {};
  for (const row of rows) {
    (combos[row.combo_product_id] ||= []).push({
      ...row,
      quantity: Number(row.quantity),
    });
  }

  return NextResponse.json({ combos, truncated: rows.length >= CAP });
}

// ── PUT ────────────────────────────────────────────────────────────────────
// Body: { combo_product_id, components: ComboComponentInput[] }
// An empty array is valid and means "this is no longer a combo".
export async function PUT(request: Request) {
  const resolved = await requireCaller(request, true);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const comboProductId = body.combo_product_id;
  if (typeof comboProductId !== "string" || !UUID_RE.test(comboProductId)) {
    return bad("combo_product_id must be a UUID", 400);
  }
  if (!Array.isArray(body.components)) return bad("components must be an array", 400);
  if (body.components.length > MAX_COMBO_ITEMS) {
    return bad(`A combo cannot have more than ${MAX_COMBO_ITEMS} items`, 400);
  }

  const { data: comboProduct, error: comboError } = await supabase
    .from("products")
    .select("id")
    .eq("id", comboProductId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (comboError) {
    console.error("[Combos] Combo product lookup failed:", comboError.message);
    return bad("Could not save the combo", 500);
  }
  if (!comboProduct) return bad("Product not found", 404);

  const components: ComboComponentInput[] = [];
  const seen = new Set<string>();

  for (const raw of body.components as Partial<ComboComponentInput>[]) {
    const reason = validateComboComponent(raw);
    if (reason) return bad(reason, 400);

    const itemId = raw.item_product_id as string;
    if (!UUID_RE.test(itemId)) return bad("item_product_id must be a UUID", 400);
    if (itemId === comboProductId) return bad("A combo cannot contain itself", 400);
    if (seen.has(itemId)) {
      return bad("The same item is listed twice — use its quantity instead", 400);
    }
    seen.add(itemId);

    components.push({
      item_product_id: itemId,
      quantity: Number(raw.quantity),
      sort_order: Number.isInteger(raw.sort_order) ? (raw.sort_order as number) : 0,
    });
  }

  if (components.length > 0) {
    const ids = components.map((c) => c.item_product_id);

    // Every item must belong to this store AND be sellable. One query.
    const { data: owned, error: ownedError } = await supabase
      .from("products")
      .select("id, kind")
      .eq("store_id", storeId)
      .in("id", ids);
    if (ownedError) {
      console.error("[Combos] Item check failed:", ownedError.message);
      return bad("Could not save the combo", 500);
    }
    const byId = new Map((owned || []).map((p: { id: string; kind: string | null }) => [p.id, p]));
    for (const id of ids) {
      const found = byId.get(id);
      // 404, never 403 — do not confirm that another store's product exists.
      if (!found) return bad("Item not found", 404);
      // Default-sellable, matching isSellable(): a row predating migration 030
      // has a null kind and is still sellable.
      if (found.kind === "ingredient") {
        return bad("A combo holds products a customer can buy, not ingredients", 400);
      }
    }

    // Refuse a combo inside a combo. resolveCombo() flattens exactly two
    // levels, and forbidding nesting here is simpler and safer than chasing
    // cycles at sale time — where getting it wrong would mis-deplete stock.
    const { data: nested, error: nestedError } = await supabase
      .from("combo_components")
      .select("combo_product_id")
      .eq("store_id", storeId)
      .in("combo_product_id", ids)
      .limit(1);
    if (nestedError) {
      console.error("[Combos] Nesting check failed:", nestedError.message);
      return bad("Could not save the combo", 500);
    }
    if (nested && nested.length > 0) {
      return bad("A combo cannot contain another combo", 400);
    }
  }

  // Replace. Two round trips, not atomic — acceptable here and nowhere near a
  // sale, because the failure mode is a combo temporarily missing items, which
  // is fixed by saving again, and no money or stock moves on this path.
  const { error: deleteError } = await supabase
    .from("combo_components")
    .delete()
    .eq("combo_product_id", comboProductId)
    .eq("store_id", storeId);

  if (deleteError) {
    console.error("[Combos] Clear failed:", deleteError.message);
    return bad("Could not save the combo", 500);
  }

  if (components.length === 0) return NextResponse.json({ components: [] });

  const { data: inserted, error: insertError } = await supabase
    .from("combo_components")
    .insert(
      components.map((c) => ({ store_id: storeId, combo_product_id: comboProductId, ...c }))
    )
    .select(SELECT_COLS);

  if (insertError) {
    if (insertError.code === FK_VIOLATION) {
      return bad("One of those products no longer exists", 409);
    }
    console.error("[Combos] Insert failed:", insertError.message);
    return bad("Could not save the combo", 500);
  }

  return NextResponse.json({ components: inserted || [] });
}

// =============================================
// /api/recipes — what menu items are made of
// =============================================
// GET  every recipe in the store, in one shot (the till caches the lot)
// PUT  replace ONE menu item's recipe wholesale
//
// PUT replaces rather than patching individual rows: the editor works on a
// whole recipe at a time, and "delete the ones that went, insert the ones that
// arrived, update the rest" is three ways to get a half-saved sandwich. The
// whole set arrives, the whole set is written.
//
// ## Auth
//
// resolveCaller() + the `inventory` permission. Editing a recipe changes what
// a customer is charged and what stock is consumed, so it sits behind the same
// gate as pricing — NOT behind `pos`. Reading is allowed for any authenticated
// caller because the till needs recipes to sell.
//
// `x-auth-data` is still an unsigned client header (audit P0-1), unchanged here.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller, canAccessSection } from "@/lib/auth/apiCaller";
import { bad, callerAndRead } from "@/lib/auth/apiRoute";
import { fetchAllPages, POSTGREST_MAX_ROWS } from "@/lib/supabase/paginate";
import {
  MAX_COMPONENTS_PER_RECIPE,
  validateComponent,
  type RecipeComponent,
  type RecipeComponentInput,
  type RecipeMap,
} from "@/lib/recipes/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FK_VIOLATION = "23503";

const SELECT_COLS =
  "id, menu_product_id, ingredient_product_id, quantity, is_default, is_removable, max_quantity, price_delta_ll, sort_order";

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

// ── GET ────────────────────────────────────────────────────────────────────
// The whole store's recipes at once. A snack shop with 80 menu items x 8
// components is ~640 rows — one request the till caches, rather than a lookup
// every time somebody taps a tile.
//
// PAGED, not `.limit()`. This read was `.limit(RECIPE_CAP)` with RECIPE_CAP at
// 5000 — and Supabase caps PostgREST at 1000 rows regardless, so the read was
// silently truncated at 1000 AND `rows.length >= RECIPE_CAP` could never be
// true. A store past 1000 components served a short recipe set flagged as
// complete, and the till under-deducted stock on whatever fell off the end:
// exactly what the flag was written to prevent. See lib/supabase/paginate.ts.
const RECIPE_CAP = 5000;

export async function GET(request: Request) {
  // `.order("id")` is a TIEBREAKER, not decoration: sort_order is not unique,
  // and rows that compare equal can move between page requests and be skipped
  // or duplicated across a boundary.
  const readPage = (
    supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
    storeId: string,
    from: number,
    to: number
  ) =>
    supabase
      .from("recipe_components")
      .select(SELECT_COLS)
      .eq("store_id", storeId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

  const resolved = await callerAndRead(request, (supabase, storeId) =>
    readPage(supabase, storeId, 0, POSTGREST_MAX_ROWS - 1)
  );
  if ("error" in resolved) return resolved.error;

  const { storeId, supabase } = resolved;
  const first = resolved.result;

  if (first.error) {
    console.error("[Recipes] List failed:", first.error.message);
    return bad("Could not load recipes", 500);
  }

  let rows = (first.data || []) as RecipeComponent[];
  let truncated = false;

  // Only if the first page came back full is there more to fetch. Those pages
  // run AFTER the caller is confirmed, which is strictly safer than the first.
  if (rows.length >= POSTGREST_MAX_ROWS) {
    const rest = await fetchAllPages<RecipeComponent>(
      (from, to) => readPage(supabase, storeId, from, to),
      RECIPE_CAP - POSTGREST_MAX_ROWS,
      // Start AFTER the page callerAndRead already read, or it is returned twice.
      POSTGREST_MAX_ROWS
    );
    if (rest.error) {
      console.error("[Recipes] List failed on a later page:", rest.error);
      return bad("Could not load recipes", 500);
    }
    rows = rows.concat(rest.rows);
    truncated = rest.truncated;
  }
  const recipes: RecipeMap = {};
  for (const row of rows) {
    (recipes[row.menu_product_id] ||= []).push({
      ...row,
      // Postgres NUMERIC/DECIMAL arrive as strings through PostgREST. Coerce
      // once, here, so nothing downstream multiplies a string by a quantity.
      quantity: Number(row.quantity),
      price_delta_ll: Number(row.price_delta_ll),
    });
  }

  return NextResponse.json({
    recipes,
    // Tells the client its copy may be short rather than letting it believe a
    // truncated recipe is the whole thing. This can now actually be true.
    truncated,
  });
}

// ── PUT ────────────────────────────────────────────────────────────────────
// Body: { menu_product_id, components: RecipeComponentInput[] }
// An empty array is valid and means "this item has no recipe any more".
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

  const menuProductId = body.menu_product_id;
  if (typeof menuProductId !== "string" || !UUID_RE.test(menuProductId)) {
    return bad("menu_product_id must be a UUID", 400);
  }
  if (!Array.isArray(body.components)) return bad("components must be an array", 400);
  if (body.components.length > MAX_COMPONENTS_PER_RECIPE) {
    return bad(`A recipe cannot have more than ${MAX_COMPONENTS_PER_RECIPE} components`, 400);
  }

  // The menu item must exist AND be this store's. Scoping here is what stops a
  // forged id from writing a recipe against someone else's product — store_id
  // on every inserted row comes from the resolved caller, never the body.
  const { data: menuProduct, error: menuError } = await supabase
    .from("products")
    .select("id")
    .eq("id", menuProductId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (menuError) {
    console.error("[Recipes] Menu product lookup failed:", menuError.message);
    return bad("Could not save the recipe", 500);
  }
  if (!menuProduct) return bad("Product not found", 404);

  const components: RecipeComponentInput[] = [];
  const seen = new Set<string>();

  for (const raw of body.components as Partial<RecipeComponentInput>[]) {
    const reason = validateComponent(raw);
    if (reason) return bad(reason, 400);

    const ingredientId = raw.ingredient_product_id as string;
    if (!UUID_RE.test(ingredientId)) return bad("ingredient_product_id must be a UUID", 400);
    if (ingredientId === menuProductId) return bad("A product cannot contain itself", 400);
    // The UNIQUE constraint would catch this, but a 400 naming the problem is
    // more use to the editor than a 23505.
    if (seen.has(ingredientId)) {
      return bad("The same ingredient is listed twice — use Max quantity instead", 400);
    }
    seen.add(ingredientId);

    components.push({
      ingredient_product_id: ingredientId,
      quantity: Number(raw.quantity),
      is_default: raw.is_default !== false,
      is_removable: raw.is_removable !== false,
      max_quantity: Number(raw.max_quantity ?? 1),
      price_delta_ll: Number(raw.price_delta_ll ?? 0),
      sort_order: Number.isInteger(raw.sort_order) ? (raw.sort_order as number) : 0,
    });
  }

  // Every ingredient must belong to this store. One query for the whole set
  // rather than one per component.
  if (components.length > 0) {
    const ids = components.map((c) => c.ingredient_product_id);
    const { data: owned, error: ownedError } = await supabase
      .from("products")
      .select("id")
      .eq("store_id", storeId)
      .in("id", ids);
    if (ownedError) {
      console.error("[Recipes] Ingredient check failed:", ownedError.message);
      return bad("Could not save the recipe", 500);
    }
    const ownedIds = new Set((owned || []).map((p: { id: string }) => p.id));
    for (const id of ids) {
      // 404, not 403 — never confirm that another store's product exists.
      if (!ownedIds.has(id)) return bad("Ingredient not found", 404);
    }
  }

  // Replace: delete then insert.
  //
  // NOT atomic — this is two round trips, and the db-migration skill is right
  // that a single plpgsql function would be better. It is acceptable HERE and
  // nowhere near a sale because the failure mode is a recipe temporarily
  // missing components, which is recoverable by saving again, and because no
  // money or stock moves on this path. If recipes ever gain a write path from
  // the till, move this into a function first.
  const { error: deleteError } = await supabase
    .from("recipe_components")
    .delete()
    .eq("menu_product_id", menuProductId)
    .eq("store_id", storeId);

  if (deleteError) {
    console.error("[Recipes] Clear failed:", deleteError.message);
    return bad("Could not save the recipe", 500);
  }

  if (components.length === 0) return NextResponse.json({ components: [] });

  const { data: inserted, error: insertError } = await supabase
    .from("recipe_components")
    .insert(
      components.map((c) => ({
        store_id: storeId,
        menu_product_id: menuProductId,
        ...c,
      }))
    )
    .select(SELECT_COLS);

  if (insertError) {
    if (insertError.code === FK_VIOLATION) {
      return bad("One of those ingredients no longer exists", 409);
    }
    console.error("[Recipes] Insert failed:", insertError.message);
    return bad("Could not save the recipe", 500);
  }

  return NextResponse.json({
    components: ((inserted || []) as RecipeComponent[]).map((row) => ({
      ...row,
      quantity: Number(row.quantity),
      price_delta_ll: Number(row.price_delta_ll),
    })),
  });
}

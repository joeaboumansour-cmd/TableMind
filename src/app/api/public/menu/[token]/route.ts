// =============================================
// GET /api/public/menu/[token] — the public menu
// =============================================
// UNAUTHENTICATED BY DESIGN. The token IS the capability: 192 bits of entropy,
// unguessable, and it identifies a menu rather than a tenant.
//
// ## What this route may return
//
// A customer sees names, prices and ingredients. It must NEVER return
// cost_price, profit_percentage, stock counts, barcodes, ids that are useful
// elsewhere, or anything about other stores. Every select below is an explicit
// column list for that reason — `select("*")` on any of these tables would
// leak margins onto a poster.
//
// Stock is not read here AT ALL. The menu never marks anything sold out —
// a shop's counted stock is not what is actually in the kitchen, and telling
// a customer an item is finished when it is not loses the sale outright.
//
// The store id is deliberately NOT in the response either. Knowing it is
// currently most of what you need to forge owner identity (audit P0-1), which
// is the whole reason this route is keyed by a token — see migration 035.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isValidMenuToken } from "@/lib/menu/types";
import { fetchAllPages } from "@/lib/supabase/paginate";
import type {
  PublicMenu,
  PublicMenuItem,
  PublicMenuSection,
} from "@/lib/menu/types";
import {
  UNCATEGORISED_SECTION_ID,
  UNCATEGORISED_SECTION_NAME,
} from "@/lib/menu/types";
import { compareCategories } from "@/lib/categories/types";
// Named constant, never an inlined 90000 — the rate has ONE definition and a
// menu quoting a stale hardcoded number would advertise the wrong price.
import { SELL_RATE } from "@/lib/utils/format";

/** PostgREST caps an unbounded select at 1000; state the limit rather than discover it. */
/**
 * Most products a public menu will show.
 *
 * 1000 is not an arbitrary round number: it is exactly **PostgREST's own
 * implicit cap**, so this limit is the cap made explicit rather than a policy
 * on top of it. Raising it without adding pagination would change nothing —
 * the extra rows would be dropped by PostgREST instead of by us, which is the
 * silent version of the same truncation.
 */
const MAX_ITEMS = 1000;

/**
 * Most recipe components to read for the menu's "comes with" lines.
 *
 * This query was UNBOUNDED, so a store with many recipes exceeded PostgREST's
 * 1000-row cap and had the tail dropped — some sandwiches quietly losing their
 * ingredient list, with nothing saying so (audit 8.1).
 *
 * 8.1 bounded it with `.limit(2000)`, which did NOT fix it: Supabase caps at
 * 1000 whatever you ask for, so the read still truncated at 1000 and the
 * `>= MAX_COMPONENTS` warning could never fire. It is PAGED now. Same mistake
 * `/api/recipes` and `/api/combos` had, made once more while fixing it — which
 * is why `verify:invariants` now refuses any `.limit()` above 1000.
 */
const MAX_COMPONENTS = 2000;

function notFound() {
  // 404 for "no such token", "menu not published" and "malformed token"
  // alike. A distinct error for each would let someone probe which tokens
  // exist.
  return NextResponse.json({ error: "Menu not found" }, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!isValidMenuToken(token)) return notFound();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const supabase = await createServiceRoleClient();

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, username, phone_whatsapp, address, menu_published")
    .eq("menu_token", token)
    .maybeSingle();

  if (storeError) {
    console.error("[Menu] Store lookup failed:", storeError.message);
    return NextResponse.json({ error: "Could not load the menu" }, { status: 500 });
  }
  if (!store || !store.menu_published) return notFound();

  const storeId = store.id as string;

  // Sellable products only. `kind` is filtered with neq so a row predating
  // migration 030 (NULL kind) is still treated as sellable — the same
  // default-sellable rule as isSellable(), applied in SQL.
  const [{ data: products, error: productsError }, { data: categories }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, name, selling_price, currency, discount_percentage, category_id, updated_at")
        .eq("store_id", storeId)
        .or("kind.is.null,kind.neq.ingredient")
        // A variant is a way of selling its parent, not a separate menu line.
        .is("parent_id", null)
        .order("name", { ascending: true })
        .limit(MAX_ITEMS),
      supabase
        .from("product_categories")
        .select("id, name, sort_order, color")
        .eq("store_id", storeId)
        .eq("is_active", true),
    ]);

  if (productsError) {
    console.error("[Menu] Products failed:", productsError.message);
    return NextResponse.json({ error: "Could not load the menu" }, { status: 500 });
  }

  const productRows = products || [];
  const productIds = productRows.map((p) => p.id as string);

  // Recipes, so the menu can say what a sandwich comes with. Only for the
  // products actually on this menu.
  const paged = productIds.length
    ? await fetchAllPages<{
        menu_product_id: string;
        ingredient_product_id: string;
        is_default: boolean;
        price_delta_ll: number;
        sort_order: number;
      }>(
        (from, to) =>
          supabase
            .from("recipe_components")
            .select("menu_product_id, ingredient_product_id, is_default, price_delta_ll, sort_order")
            .eq("store_id", storeId)
            .in("menu_product_id", productIds)
            .order("sort_order", { ascending: true })
            // The tiebreaker pagination needs; sort_order is not unique.
            .order("id", { ascending: true })
            .range(from, to),
        MAX_COMPONENTS
      )
    : { rows: [], truncated: false, error: null };

  const recipeRows = paged.rows;

  // Say so rather than serving a quietly incomplete menu. Nothing here is worth
  // failing the request over — a menu missing some "comes with" lines is still
  // a usable menu — but it must not be invisible.
  if (paged.truncated) {
    console.error(
      `[Menu] recipe_components hit MAX_COMPONENTS (${MAX_COMPONENTS}) for store ${storeId}; ` +
        "some items will be missing their ingredient lines."
    );
  }

  // Ingredient NAMES only — never their stock or cost.
  const ingredientIds = Array.from(
    new Set(recipeRows.map((r) => r.ingredient_product_id as string))
  );
  const ingredientNames = new Map<string, string>();
  if (ingredientIds.length) {
    const { data: ingredients } = await supabase
      .from("products")
      .select("id, name")
      .eq("store_id", storeId)
      .in("id", ingredientIds);
    for (const row of ingredients || []) {
      ingredientNames.set(row.id as string, row.name as string);
    }
  }

  const byProduct = new Map<string, typeof recipeRows>();
  for (const row of recipeRows) {
    const key = row.menu_product_id as string;
    const list = byProduct.get(key) || [];
    list.push(row);
    byProduct.set(key, list);
  }

  let latest: string | null = null;

  const items = new Map<string, PublicMenuItem[]>();
  for (const product of productRows) {
    const components = byProduct.get(product.id as string) || [];

    const contains: string[] = [];
    const extras: Array<{ name: string; price_ll: number }> = [];
    for (const c of components) {
      const name = ingredientNames.get(c.ingredient_product_id as string);
      if (!name) continue;
      if (c.is_default) contains.push(name);
      else extras.push({ name, price_ll: Number(c.price_delta_ll) || 0 });
    }

    // Price as a customer would be charged: the catalogue price less any
    // product discount, normalised to LL. Exact — the 5,000 rounding belongs
    // to a cart total, and a menu is not a cart.
    const base = Number(product.selling_price) || 0;
    const discount = Number(product.discount_percentage) || 0;
    const priceLl =
      product.currency === "USD"
        ? base * SELL_RATE * (1 - discount / 100)
        : base * (1 - discount / 100);

    const updated = product.updated_at as string | null;
    if (updated && (!latest || updated > latest)) latest = updated;

    const item: PublicMenuItem = {
      id: product.id as string,
      name: product.name as string,
      price_ll: priceLl,
      contains,
      extras,
    };

    const key = (product.category_id as string) || UNCATEGORISED_SECTION_ID;
    const list = items.get(key) || [];
    list.push(item);
    items.set(key, list);
  }

  const sections: PublicMenuSection[] = [];
  for (const category of (categories || []).slice().sort(compareCategories)) {
    const list = items.get(category.id as string);
    // An empty category is not worth a heading on a printed menu.
    if (list && list.length > 0) {
      sections.push({ id: category.id as string, name: category.name as string, items: list });
    }
  }
  const uncategorised = items.get(UNCATEGORISED_SECTION_ID);
  if (uncategorised && uncategorised.length > 0) {
    // Last, and only when something is in it. A store with no categories at
    // all gets one unnamed-looking section rather than an empty menu.
    sections.push({
      id: UNCATEGORISED_SECTION_ID,
      name: sections.length > 0 ? UNCATEGORISED_SECTION_NAME : "Menu",
      items: uncategorised,
    });
  }

  const menu: PublicMenu = {
    store: {
      name: (store.username as string) || "Menu",
      phone_whatsapp: (store.phone_whatsapp as string) || null,
      address: (store.address as string) || null,
    },
    sections,
    updated_at: latest,
  };

  return NextResponse.json(menu, {
    headers: {
      // A menu is public and changes rarely. Cache at the edge for a minute and
      // allow a stale copy for an hour, so a poster scanned by fifty people at
      // lunch does not become fifty database round trips.
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=3600",
    },
  });
}

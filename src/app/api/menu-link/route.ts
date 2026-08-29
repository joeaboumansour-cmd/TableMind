// =============================================
// /api/menu-link — the store's own menu link
// =============================================
// GET   the current token and whether the menu is live
// POST  publish (minting a token the first time), unpublish, or rotate
//
// Gated on `inventory`: publishing a menu makes the catalogue and its prices
// public, which is the same class of decision as setting those prices.
//
// Note this is the STORE-FACING route. The customer-facing one is
// /api/public/menu/[token], which is unauthenticated and returns no ids.
// =============================================

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller, canAccessSection } from "@/lib/auth/apiCaller";
import { generateMenuToken } from "@/lib/menu/types";

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function requireCaller(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }
  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  const caller = await resolveCaller(supabase, storeId, userId);
  if (!caller) return { error: bad("Unauthorized", 401) };
  if (!canAccessSection(caller, "inventory")) return { error: bad("Forbidden", 403) };
  return { supabase, storeId };
}

export async function GET(request: Request) {
  const resolved = await requireCaller(request);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  const { data, error } = await supabase
    .from("stores")
    .select("menu_token, menu_published")
    .eq("id", storeId)
    .maybeSingle();

  if (error) {
    console.error("[MenuLink] Read failed:", error.message);
    return bad("Could not load the menu link", 500);
  }

  return NextResponse.json({
    token: data?.menu_token ?? null,
    published: data?.menu_published === true,
  });
}

// Body: { action: "publish" | "unpublish" | "rotate" }
export async function POST(request: Request) {
  const resolved = await requireCaller(request);
  if ("error" in resolved) return resolved.error;
  const { supabase, storeId } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON body", 400);
  }

  const action = body.action;
  if (action !== "publish" && action !== "unpublish" && action !== "rotate") {
    return bad("action must be publish, unpublish or rotate", 400);
  }

  const { data: current, error: readError } = await supabase
    .from("stores")
    .select("menu_token")
    .eq("id", storeId)
    .maybeSingle();

  if (readError) {
    console.error("[MenuLink] Read failed:", readError.message);
    return bad("Could not update the menu link", 500);
  }

  const updates: Record<string, unknown> = {};

  if (action === "unpublish") {
    // The token is KEPT. Taking a menu down must not invalidate a QR code
    // already printed on fifty table tents — republishing brings the same
    // link back. Rotate is the deliberate way to break old prints.
    updates.menu_published = false;
  } else if (action === "rotate") {
    updates.menu_token = generateMenuToken();
    updates.menu_published = true;
  } else {
    // Publish. Mint a token only if there is not one already, so publishing
    // twice does not silently break yesterday's poster.
    updates.menu_token = current?.menu_token || generateMenuToken();
    updates.menu_published = true;
  }

  const { data, error } = await supabase
    .from("stores")
    .update(updates)
    .eq("id", storeId)
    .select("menu_token, menu_published")
    .maybeSingle();

  if (error) {
    console.error("[MenuLink] Update failed:", error.message);
    return bad("Could not update the menu link", 500);
  }

  return NextResponse.json({
    token: data?.menu_token ?? null,
    published: data?.menu_published === true,
  });
}

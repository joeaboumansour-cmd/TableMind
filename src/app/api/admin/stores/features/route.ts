// =============================================
// Store feature flags. (audit P0-2)
//
// This route had NO authentication of any kind while holding the service-role
// key: anyone who knew a store id could read or FLIP any store's feature flags
// and store_type. Closing it needs care, because the two verbs have genuinely
// different audiences:
//
//   GET   — the ADMIN console reads any store's flags, and every TILL reads
//           its OWN via useFeatureFlags. That hook drives the nav, the POS
//           layout, the cash page and the kitchen board, so gating this on an
//           admin session alone would switch the product off in every shop.
//   PATCH — administration. Admin only.
//
// So GET accepts either an admin session OR a resolved store caller asking
// for THEIR OWN store, and refuses a store caller asking about anyone else.
// =============================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/auth/adminSession";
import { readAuthHeader, resolveCaller } from "@/lib/auth/apiCaller";

export async function GET(request: Request) {
  try {
    const supabase = await createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");

    if (!storeId) {
      return NextResponse.json({ error: "store_id is required" }, { status: 400 });
    }

    const readFeatures = () =>
      supabase.from("stores").select("features, store_type").eq("id", storeId).single();

    const { storeId: callerStore, userId } = readAuthHeader(request);

    // THE TILL'S PATH, and the hot one: a store reading its OWN flags.
    //
    // One wave, not two. This resolved the caller and THEN read, so every
    // caller paid full network latency twice — measured at 613 ms against a
    // ~300 ms single-round-trip floor, on a route `useFeatureFlags` puts on the
    // boot path of every screen.
    //
    // Safe for exactly the reason CLAUDE.md gives for the routes already doing
    // it, and note WHY the equality check comes first: it makes the read scoped
    // to the store the caller is CLAIMING IN THEIR OWN HEADER. A failed auth
    // then discards a read of their own store — which is the property that
    // makes racing auth acceptable, and it would be lost if the read were
    // scoped to the query parameter before knowing the two agree.
    let result;
    if (callerStore && callerStore === storeId) {
      const [caller, read] = await Promise.all([
        resolveCaller(supabase, callerStore, userId),
        Promise.resolve(readFeatures()),
      ]);
      if (!caller) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      result = read;
    } else {
      // Any OTHER store means an admin, and only an admin. Left serial on
      // purpose: `verifyAdminSession` is a cookie verification with no database
      // round trip, so racing it would save nothing and would start a read of
      // a store the caller has not claimed.
      const admin = await verifyAdminSession(request);
      if (!admin) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      result = await readFeatures();
    }

    const { data, error } = result;

    if (error) {
      console.error("Error fetching store features:", error);
      return NextResponse.json({ error: "Failed to fetch store features" }, { status: 500 });
    }

    return NextResponse.json({
      features: data?.features || {},
      store_type: data?.store_type || "general",
    });
  } catch (error: any) {
    console.error("Error fetching store features:", error);
    return NextResponse.json({ error: "Failed to fetch store features" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    // Flipping another store's flags is pure administration — there is no
    // legitimate till-side caller, so this is admin-only with no store path.
    const admin = await verifyAdminSession(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await createServiceRoleClient();

    const body = await request.json();
    const { store_id, features, store_type } = body;

    if (!store_id) {
      return NextResponse.json({ error: "store_id is required" }, { status: 400 });
    }

    const updateData: Record<string, any> = {};
    if (features !== undefined) updateData.features = features;
    if (store_type !== undefined) updateData.store_type = store_type;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No data to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("stores")
      .update(updateData)
      .eq("id", store_id)
      .select("features, store_type")
      .single();

    if (error) {
      console.error("Error updating store features:", error);
      return NextResponse.json({ error: "Failed to update store features" }, { status: 500 });
    }

    return NextResponse.json({
      features: data?.features || {},
      store_type: data?.store_type || "general",
    });
  } catch (error: any) {
    console.error("Error updating store features:", error);
    return NextResponse.json({ error: "Failed to update store features" }, { status: 500 });
  }
}
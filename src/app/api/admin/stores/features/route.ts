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

    // An admin may read any store. Checked first because it is a cookie
    // verification with no database round trip.
    const admin = await verifyAdminSession(request);
    if (!admin) {
      // Otherwise the caller must BE this store. resolveCaller runs
      // concurrently with nothing here — the read below cannot start until we
      // know which store is allowed, and that is the point.
      const { storeId: callerStore, userId } = readAuthHeader(request);
      if (!callerStore || callerStore !== storeId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const caller = await resolveCaller(supabase, callerStore, userId);
      if (!caller) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { data, error } = await supabase
      .from("stores")
      .select("features, store_type")
      .eq("id", storeId)
      .single();

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
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const supabase = await createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");

    if (!storeId) {
      return NextResponse.json({ error: "store_id is required" }, { status: 400 });
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
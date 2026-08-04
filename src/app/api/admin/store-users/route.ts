import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/admin/store-users?store_id=xxx — list employees for a store
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get("store_id");

    if (!storeId) {
      return NextResponse.json(
        { error: "store_id is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("store_users")
      .select("id, store_id, username, display_name, is_active, permissions, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching store users:", error);
      return NextResponse.json(
        { error: "Failed to fetch employees" },
        { status: 500 }
      );
    }

    return NextResponse.json({ employees: data || [] });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/admin/store-users — create a new employee
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { store_id, username, password, display_name, permissions } = body;

    if (!store_id || !username || !password) {
      return NextResponse.json(
        { error: "store_id, username, and password are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("store_users")
      .insert({
        store_id,
        username,
        password_hash: password,
        display_name: display_name || username,
        is_active: true,
        permissions: permissions || {
          pos: false,
          inventory: false,
          transactions: false,
          receipts: false,
          cash_register: false,
        },
      })
      .select("id, store_id, username, display_name, is_active, permissions, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "An employee with this username already exists in this store" },
          { status: 409 }
        );
      }
      console.error("Error creating store user:", error);
      return NextResponse.json(
        { error: "Failed to create employee" },
        { status: 500 }
      );
    }

    return NextResponse.json({ employee: data }, { status: 201 });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/store-users — update employee (permissions, name, password, active status)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, username, password, display_name, is_active, permissions } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Employee id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {};
    if (username !== undefined) updates.username = username;
    if (password !== undefined) updates.password_hash = password;
    if (display_name !== undefined) updates.display_name = display_name;
    if (is_active !== undefined) updates.is_active = is_active;
    if (permissions !== undefined) updates.permissions = permissions;

    const { data, error } = await supabaseAdmin
      .from("store_users")
      .update(updates)
      .eq("id", id)
      .select("id, store_id, username, display_name, is_active, permissions, created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "An employee with this username already exists" },
          { status: 409 }
        );
      }
      console.error("Error updating store user:", error);
      return NextResponse.json(
        { error: "Failed to update employee" },
        { status: 500 }
      );
    }

    return NextResponse.json({ employee: data });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/store-users?id=xxx — delete an employee
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Employee id is required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("store_users")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting store user:", error);
      return NextResponse.json(
        { error: "Failed to delete employee" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
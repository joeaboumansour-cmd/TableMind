// =============================================
// Employee administration. (audit P0-2)
//
// This route had NO authentication of any kind while holding the service-role
// key. GET listed any store's employees; POST created one in ANY store with
// ARBITRARY permissions; PATCH changed any employee's password_hash, username
// or permissions BY ID ALONE with no store scoping; DELETE removed any
// employee. That is a full multi-tenant takeover from an unauthenticated
// request.
//
// Every verb is now behind the admin session. Confirmed first that nothing on
// the till side calls it — the only callers are /admin and /admin/activity.
// (The cash page gets its employee list from GET /api/cash-shifts, which is
// separately gated.)
//
// PATCH and DELETE still address an employee BY ID ALONE, with no store
// filter, and that is left as it is deliberately. The audit lists it as part
// of this finding, but it is only a takeover while the route is open: the
// admin console is a cross-store superuser by design, so an admin editing an
// employee in any store is that role working correctly. Requiring a store_id
// would mean changing both console call sites for no security gain, on a
// screen this change is not otherwise touching.
//
// If the admin role is ever narrowed to a subset of stores, THAT is when this
// needs a store filter — and it will need one urgently.
// =============================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDefaultPermissions } from "@/lib/auth/permissions";
import { verifyAdminSession } from "@/lib/auth/adminSession";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET /api/admin/store-users?store_id=xxx — list employees for a store
export async function GET(request: Request) {
  try {
    const admin = await verifyAdminSession(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const admin = await verifyAdminSession(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
        // Derived from SECTIONS, never listed by hand — a hand-written copy
        // is how the `kitchen` section came to be ungrantable. The admin UI
        // always sends `permissions`, so this is only the fallback, but a
        // fallback that silently omits a section is exactly the same bug.
        permissions: permissions || getDefaultPermissions(),
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
    const admin = await verifyAdminSession(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const admin = await verifyAdminSession(request);
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
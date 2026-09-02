import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  isAdminSessionConfigured,
  signAdminSession,
  setAdminSessionCookie,
} from "@/lib/auth/adminSession";

// The comment here used to say "service_role key to bypass RLS" while the
// client was actually built from NEXT_PUBLIC_SUPABASE_ANON_KEY. It worked only
// because that public var currently holds a service_role JWT (bug-0006) — the
// moment it holds a real anon key, RLS hides `admin_users` and no admin can
// sign in. `createServiceRoleClient()` reads SUPABASE_SERVICE_ROLE_KEY, which
// is what every other route already uses.

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    // Fail before touching credentials if sessions cannot be issued — better a
    // clear 500 at login than an admin who appears signed in but is refused by
    // every gated route.
    if (!isAdminSessionConfigured()) {
      console.error("[AdminLogin] ADMIN_JWT_SECRET is not configured — refusing to sign in");
      return NextResponse.json(
        { error: "Admin sessions are not configured on this server" },
        { status: 500 }
      );
    }

    const supabaseAdmin = await createServiceRoleClient();

    // Fetch admin user by username
    const { data: admin, error: fetchError } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("username", username)
      .single();

    // NOTE: this route used to console.log the submitted password alongside the
    // stored password_hash on every attempt (audit P0-4). Credentials must
    // never reach a log. Failures are reported without either value.
    if (fetchError || !admin) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Verify password (direct comparison as per current implementation)
    const isValidPassword = admin.password_hash === password;

    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Return admin data (without password hash)
    const response = NextResponse.json({
      success: true,
      admin: {
        id: admin.id,
        username: admin.username,
        created_at: admin.created_at,
      },
    });

    // The httpOnly cookie is the real credential — the localStorage blob the
    // client still writes only drives the redirect on /admin pages and is not
    // trusted by any route.
    const token = await signAdminSession(admin.id, admin.username);
    return setAdminSessionCookie(response, token);
  } catch (error) {
    console.error("Admin login error:", error);
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}

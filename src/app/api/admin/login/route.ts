import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Create a Supabase client with service_role key to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    // Fetch admin user by username
    const { data: admin, error: fetchError } = await supabaseAdmin
      .from("admin_users")
      .select("*")
      .eq("username", username)
      .single();

    console.log("Login attempt:", { username, password, fetchError, admin });

    if (fetchError || !admin) {
      console.log("Fetch error or no admin:", fetchError);
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Verify password (direct comparison as per current implementation)
    const isValidPassword = admin.password_hash === password;
    console.log("Password comparison:", { 
      storedHash: admin.password_hash, 
      inputPassword: password, 
      isValid: isValidPassword 
    });

    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Return admin data (without password hash)
    return NextResponse.json({
      success: true,
      admin: {
        id: admin.id,
        username: admin.username,
        created_at: admin.created_at,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-secret-key-min-32-characters-long"
);

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Find user by username
    const { data: user, error: userError } = await supabase
      .from("restaurant_users")
      .select("*, restaurants(*)")
      .eq("username", username)
      .eq("is_active", true)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Check if restaurant is active and license is valid
    const restaurant = user.restaurants;
    
    if (!restaurant.is_active) {
      return NextResponse.json(
        { error: "Restaurant account is inactive" },
        { status: 403 }
      );
    }

    // Check license/trial expiry
    const now = new Date();
    if (restaurant.license_end_date && new Date(restaurant.license_end_date) < now) {
      return NextResponse.json(
        { error: "License has expired. Please contact administrator." },
        { status: 403 }
      );
    }
    if (restaurant.trial_ends_at && new Date(restaurant.trial_ends_at) < now) {
      return NextResponse.json(
        { error: "Trial period has ended. Please contact administrator." },
        { status: 403 }
      );
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      );
    }

    // Update last login
    await supabase
      .from("restaurant_users")
      .update({
        last_login_at: new Date().toISOString(),
        login_count: user.login_count + 1,
      })
      .eq("id", user.id);

    // Create JWT token
    const token = await new SignJWT({
      userId: user.id,
      restaurantId: user.restaurant_id,
      username: user.username,
      role: user.role,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(JWT_SECRET);

    // Return user data (exclude password_hash)
    const { password_hash, ...userWithoutPassword } = user;

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
      },
      restaurant: {
        id: restaurant.id,
        private_id: restaurant.private_id,
        name: restaurant.name,
        slug: restaurant.slug,
        subscription_tier: restaurant.subscription_tier,
        timezone: restaurant.timezone,
        settings: restaurant.settings,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}

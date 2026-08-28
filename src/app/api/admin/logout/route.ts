import { NextResponse } from "next/server";
import { clearAdminSessionCookie } from "@/lib/auth/adminSession";

/**
 * Drop the admin session cookie.
 *
 * The cookie is httpOnly, so the admin page cannot clear it itself — signing
 * out has to go through the server or the session would outlive the click.
 */
export async function POST() {
  return clearAdminSessionCookie(NextResponse.json({ success: true }));
}

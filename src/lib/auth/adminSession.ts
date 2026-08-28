/**
 * Signed admin sessions.
 *
 * The admin console had no server-side auth of any kind: /admin checks a
 * localStorage flag for the redirect, and every route under /api/admin/ is
 * openly callable. That was already bad; an endpoint serving the full activity
 * trail of every store in the fleet makes it indefensible, so the new admin
 * routes are gated on a token the server actually verifies.
 *
 * ⚠️ Do NOT reuse src/lib/auth/jwt.ts for this. That file is leftover
 * TableMind scaffolding — its payload is `restaurantId`, nothing imports it,
 * and its secret falls back to a hardcoded default (audit P0-8), which means a
 * deployment with no secret configured would happily verify tokens anyone can
 * mint. This module fails closed instead.
 *
 * Scope: this covers the admin surface only. Store-side auth is still the
 * unsigned `x-auth-data` header (audit P0-1) and is a separate project.
 */

import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";

export const ADMIN_COOKIE = "gs_admin_session";

/** 12 hours. Long enough for a working day, short enough that a leaked token expires. */
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const ISSUER = "goldensquirrel";
const AUDIENCE = "goldensquirrel-admin";

export interface AdminSession {
  adminId: string;
  username: string;
}

/**
 * The signing key, or a thrown error.
 *
 * No fallback secret. A missing ADMIN_JWT_SECRET must break the admin login
 * loudly at request time, not silently downgrade every admin session to one
 * that anybody can forge. Read lazily so importing this module never throws at
 * build time.
 */
function getSecret(): Uint8Array {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "ADMIN_JWT_SECRET is not configured (needs at least 32 characters). Admin sessions cannot be issued or verified."
    );
  }
  return new TextEncoder().encode(secret);
}

/** True when the environment can sign sessions at all. Used to fail a login cleanly. */
export function isAdminSessionConfigured(): boolean {
  try {
    getSecret();
    return true;
  } catch {
    return false;
  }
}

export async function signAdminSession(adminId: string, username: string): Promise<string> {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Read the session cookie off a request.
 *
 * Parsed from the header rather than via next/headers cookies() so this works
 * with the plain `Request` signature every route in this app uses.
 */
function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === ADMIN_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    }
  }
  return null;
}

/** Verify the caller's admin session. Returns null for missing, expired, or tampered tokens. */
export async function verifyAdminSession(request: Request): Promise<AdminSession | null> {
  const token = readSessionCookie(request);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const adminId = typeof payload.sub === "string" ? payload.sub : null;
    const username = typeof payload.username === "string" ? payload.username : null;
    if (!adminId || !username) return null;

    return { adminId, username };
  } catch {
    // Expired, tampered, wrong audience, or the secret is missing. All of them
    // mean the same thing to the caller: not authenticated. Nothing is logged
    // here — the token is a credential.
    return null;
  }
}

/**
 * Gate a route on an admin session.
 *
 * Returns either the session or the 401 response to return as-is:
 *
 *   const session = await requireAdmin(request);
 *   if (session instanceof NextResponse) return session;
 */
export async function requireAdmin(request: Request): Promise<AdminSession | NextResponse> {
  const session = await verifyAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

/** Attach a freshly signed session cookie to a response. */
export function setAdminSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set({
    name: ADMIN_COOKIE,
    value: token,
    // httpOnly so page JS — including anything injected into the admin console
    // — cannot read or exfiltrate it.
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

/** Clear the session cookie. */
export function clearAdminSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: ADMIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

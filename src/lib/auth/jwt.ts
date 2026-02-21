/**
 * JWT Authentication Helpers for API Routes
 * 
 * These utilities help verify the custom JWT tokens used by the application
 * and extract restaurant information for proper tenant isolation.
 */

import { jwtVerify, JWTPayload } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "your-secret-key-min-32-characters-long"
);

export interface CustomJWTPayload extends JWTPayload {
  userId: string;
  restaurantId: string;
  username: string;
  role: string;
}

/**
 * Verify and decode a JWT token
 * @param token The JWT token to verify
 * @returns The decoded payload or null if invalid
 */
export async function verifyJWT(token: string): Promise<CustomJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as CustomJWTPayload;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

/**
 * Extract JWT token from Authorization header
 * @param authHeader The Authorization header value
 * @returns The token or null if not found/invalid format
 */
export function extractTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }
  
  return parts[1];
}

/**
 * Get restaurant ID from JWT token
 * @param token The JWT token
 * @returns The restaurant ID or null if invalid
 */
export async function getRestaurantIdFromToken(token: string): Promise<string | null> {
  const payload = await verifyJWT(token);
  return payload?.restaurantId || null;
}

/**
 * Check if user is authenticated and return their details
 * @param authHeader The Authorization header
 * @returns User details or null if not authenticated
 */
export async function getAuthenticatedUser(authHeader: string | null) {
  const token = extractTokenFromHeader(authHeader);
  if (!token) return null;
  
  const payload = await verifyJWT(token);
  if (!payload) return null;
  
  return {
    userId: payload.userId,
    restaurantId: payload.restaurantId,
    username: payload.username,
    role: payload.role,
  };
}

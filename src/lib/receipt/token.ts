// =============================================
// Receipt Token Generation
// Unguessable capability URL token for public receipts.
// Generated client-side at checkout so it works fully offline.
// =============================================

/**
 * Generate a cryptographically random receipt token.
 *
 * Uses crypto.getRandomValues (available in all modern browsers and
 * Node.js) to produce ~128 bits of entropy — unguessable by brute force.
 *
 * Format: 32 URL-safe base64 characters (no padding).
 * Example: "aB3dEfGhIjKlMnOpQrStUvWxYz012345"
 */
export function generateReceiptToken(): string {
  const bytes = new Uint8Array(24); // 24 bytes = 192 bits of entropy
  crypto.getRandomValues(bytes);

  // Convert to base64url (URL-safe, no padding)
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Validate that a token looks like a receipt token.
 * Used by the public API to reject malformed tokens early.
 */
export function isValidReceiptToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  // 24 bytes → 32 base64url chars (no padding)
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}
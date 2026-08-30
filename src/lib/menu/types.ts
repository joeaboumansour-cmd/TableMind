// =============================================
// Public menu — shared shapes
// =============================================
// Used by the public page, the API that feeds it, and the in-app QR dialog.
// =============================================

/** One thing a customer can order. */
export interface PublicMenuItem {
  id: string;
  name: string;
  /** Always LL. USD is derived for display, never stored per item. */
  price_ll: number;
  /** What it comes with, by name. Empty for an item with no recipe. */
  contains: string[];
  /** Optional extras the recipe offers, with what each costs. */
  extras: Array<{ name: string; price_ll: number }>;
}

// There is deliberately NO availability field. The menu is a printed board,
// not a live stock display: a shop's counted stock is not what is actually in
// the kitchen, and telling a customer an item is finished when it is not loses
// the sale outright. Stock lives on the till, where a person can see it.

export interface PublicMenuSection {
  id: string;
  name: string;
  items: PublicMenuItem[];
}

export interface PublicMenu {
  store: {
    name: string;
    phone_whatsapp: string | null;
    address: string | null;
  };
  sections: PublicMenuSection[];
  /** When the underlying catalogue last changed — shown as "updated ...". */
  updated_at: string | null;
}

/** Section for products with no category. Last, and only when non-empty. */
export const UNCATEGORISED_SECTION_ID = "__other__";
export const UNCATEGORISED_SECTION_NAME = "More";

/**
 * Generate a menu token.
 *
 * Same shape and entropy as a receipt token — 24 random bytes as 32 base64url
 * characters. Unguessable by brute force, and safe in a URL, a QR code and a
 * printed poster.
 */
export function generateMenuToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Reject a malformed token before it reaches the database. */
export function isValidMenuToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  return /^[A-Za-z0-9_-]{32}$/.test(token);
}

/** The public URL for a token, absolute so it can go straight into a QR. */
export function menuUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/menu/${token}`;
}

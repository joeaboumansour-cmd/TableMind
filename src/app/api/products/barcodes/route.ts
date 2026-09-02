// =============================================
// GET /api/products/barcodes?prefix=… — existing barcodes under a prefix
// =============================================
//
// The barcode generator (`/barcodegen`) has to know which sequence numbers a
// store has already issued for a category/colour/size combination, or it hands
// out a label that collides with a product on the shelf. It answered that by
// selecting `products.barcode` from the BROWSER with the public Supabase
// client — one of the reads keeping a `service_role` key in the bundle.
//
// Deliberately dumb: it returns the matching barcodes and nothing else. The
// sequence is the 9th and 10th characters of an EAN-13, and that parsing stays
// in `src/lib/barcode/generator.ts` / the page, so the server and the client
// cannot come to different answers about what the next number is.
//
// ## Auth
//
// `resolveCaller()` plus the `inventory` section — the same permission that
// gates every other act which changes what a customer is charged. Printing the
// labels a shop scans is squarely in that group.
//
// `x-auth-data` is still an unsigned client header (audit P0-1); this route is
// no more authenticated than its neighbours.
//
// ## Tenancy
//
// Scoped to the caller's own `store_id`. Note that the 4-digit "store id" the
// generator asks for is a LABEL the shop chose for its own numbering scheme,
// not the tenant UUID — it arrives as part of `prefix` and is matched against
// barcode text. It must never be mistaken for the tenancy filter.
// =============================================

import { NextResponse } from "next/server";
import { bad, callerAndRead } from "@/lib/auth/apiRoute";
import { canAccessSection } from "@/lib/auth/apiCaller";

/**
 * An EAN-13 prefix: digits only, and no longer than the code itself.
 *
 * Digits-only is also what makes the `like` pattern safe — `%` and `_` are
 * wildcards in a LIKE and cannot appear in a value that matched this.
 */
const PREFIX_RE = /^\d{1,13}$/;

/** A store issues 99 sequences per combination; this is generous headroom. */
const MAX_ROWS = 500;

export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get("prefix") || "";
  if (!PREFIX_RE.test(prefix)) {
    return bad("prefix must be 1-13 digits", 400);
  }

  const resolved = await callerAndRead(request, (supabase, storeId) =>
    supabase
      .from("products")
      .select("barcode")
      .eq("store_id", storeId)
      .like("barcode", `${prefix}%`)
      .limit(MAX_ROWS)
  );
  if ("error" in resolved) return resolved.error;
  if (!canAccessSection(resolved.caller, "inventory")) return bad("Forbidden", 403);

  const { data, error } = resolved.result;
  if (error) {
    console.error("[Barcodes] Lookup failed:", error.message);
    return bad("Could not check existing barcodes", 500);
  }

  const barcodes = ((data || []) as { barcode: string | null }[])
    .map((row) => row.barcode)
    .filter((barcode): barcode is string => !!barcode);

  return NextResponse.json({ barcodes });
}

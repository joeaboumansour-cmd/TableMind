// =============================================
// Shared plumbing for store-facing API routes
// =============================================
//
// `apiCaller.ts` answers "who is calling and what may they do". This answers
// "how does a route ask that question without paying for it twice".
//
// It exists because the same two helpers had been copied into
// /api/categories, /api/recipes and /api/combos verbatim. Three copies of an
// AUTH helper is exactly the shape that lets one of them drift and quietly
// stop checking something — the same class of bug as the three hand-written
// permission mappings that `parsePermissions()` replaced.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { readAuthHeader, resolveCaller } from "@/lib/auth/apiCaller";

/** The error contract every store-facing route returns. */
export function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;
type ResolvedCaller = NonNullable<Awaited<ReturnType<typeof resolveCaller>>>;

export type CallerAndRead<T> =
  | { error: NextResponse }
  | { caller: ResolvedCaller; storeId: string; result: T; supabase: ServiceClient };

/**
 * Resolve the caller and run a store-scoped read CONCURRENTLY.
 *
 * The sequential shape this replaces — resolve who is calling, *then* query —
 * is two full round trips deep before a byte of data is read, on routes the
 * POS fires three of at once on launch. Neither step reads what the other
 * writes, and the query is already scoped to the `store_id` the caller is
 * claiming, so a failed auth discards a read of the caller's OWN store and
 * never touches another tenant.
 *
 * Same trade `GET /api/cash-shifts` makes in its "Wave 1" comment: overlap the
 * latency, decide afterwards, return nothing until the caller is confirmed.
 *
 * NOTE the ordering guarantee this preserves. `read` may only ever be a READ.
 * Handing it something that writes would mean writing before the caller is
 * known, which is the opposite of what this is for — write handlers must keep
 * using the sequential gate.
 */
export async function callerAndRead<T>(
  request: Request,
  read: (supabase: ServiceClient, storeId: string) => PromiseLike<T>
): Promise<CallerAndRead<T>> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { error: bad("Supabase is not configured", 500) };
  }

  const supabase = await createServiceRoleClient();
  const { storeId, userId } = readAuthHeader(request);
  if (!storeId) return { error: bad("Unauthorized", 401) };

  // Promise.resolve() so the PostgREST builder (a thenable, not a Promise) is
  // a real Promise before Promise.all sees it — otherwise T infers as unknown.
  const readPromise: Promise<T> = Promise.resolve(read(supabase, storeId));
  const [caller, result] = await Promise.all([
    resolveCaller(supabase, storeId, userId),
    readPromise,
  ]);

  if (!caller) return { error: bad("Unauthorized", 401) };
  // `supabase` is returned so a route that needs FURTHER pages can keep reading
  // without building a second client — and, more to the point, so those pages
  // happen AFTER the caller is confirmed rather than racing auth the way the
  // first one deliberately does.
  return { caller, storeId, result, supabase };
}

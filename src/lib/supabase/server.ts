import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role Supabase client used by every API route.
 *
 * ## Why this is not `createServerClient` any more
 *
 * It used to `await cookies()` and hand @supabase/ssr a full cookie adapter,
 * then build a `createServerClient` — GoTrue session storage and all — on
 * **every request to every route**. None of that did anything:
 *
 *   * The service-role key bypasses RLS and never authenticates as a user, so
 *     there is no session to read from a cookie or write back to one.
 *   * This app does not use Supabase Auth at all (CLAUDE.md §5). There has
 *     never been a Supabase cookie to find.
 *
 * So each request paid for `cookies()` plus the construction of a client with
 * auth, realtime, storage and postgrest sub-clients, to use exactly one of
 * them. `src/app/api/admin/login/route.ts` and `api/products/export` already
 * did it the plain way at module scope; this brings the other seventeen routes
 * in line.
 *
 * ## Why it is memoised
 *
 * The client is stateless for what we ask of it (PostgREST queries and RPCs
 * with a fixed key), so one instance is correct and is what the plain
 * module-scope pattern above has always relied on. On a warm serverless
 * instance that turns "build a client" into a property read.
 *
 * `persistSession` / `autoRefreshToken` / `detectSessionInUrl` are all off: a
 * refresh timer on a service-role key is meaningless and would keep the
 * instance alive.
 *
 * Still `async`. Every call site is `await createServiceRoleClient()`, and the
 * signature is worth keeping stable — it also leaves room to go back to a
 * per-request client if a signed store session ever needs one.
 */
let cached: SupabaseClient | null = null;

export async function createServiceRoleClient(): Promise<SupabaseClient> {
  if (cached) return cached;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Service role key not configured");
  }

  cached = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cached;
}

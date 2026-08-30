import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware passthrough.
 *
 * ## Why there is no Supabase client here any more
 *
 * This function used to build a full `createServerClient` — GoTrue, PostgREST,
 * Realtime and Storage sub-clients, plus a cookie adapter — and then return
 * without ever calling it. Its own comment said so: "No session check is needed
 * here." So every request that matched `src/middleware.ts`'s matcher paid for a
 * client that answered no question.
 *
 * That is not an occasional cost. The matcher covers every page navigation and
 * every `/api/*` call, which includes the connectivity heartbeat's probe of
 * `/api/health` — once every 15 seconds, per open tab, all day, on every till
 * in every shop. It was pure latency in front of the one endpoint whose whole
 * job is to answer as fast as possible.
 *
 * ## This is NOT where authorization was removed
 *
 * There was never any here to remove. Login is hand-rolled against the
 * `stores` / `store_users` tables and lives in localStorage; API routes read
 * tenancy from the unsigned `x-auth-data` header (CLAUDE.md §5, audit P0-1).
 * The middleware enforced nothing before this change and enforces nothing
 * after it — the behaviour is identical, the allocation is gone.
 *
 * When store sessions become signed, THIS is the right place to verify them:
 * a `jose` verify against the `ADMIN_JWT_SECRET`-style secret, rejecting before
 * the route handler runs. Note that the matcher deliberately excludes `sw.js`
 * and `manifest.json` — if this ever redirects unauthenticated requests,
 * service-worker registration must not be caught by it or all offline support
 * dies. See the note above `config` in src/middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}

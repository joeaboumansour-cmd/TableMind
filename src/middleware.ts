import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// NOTE: sw.js / workbox-*.js / swe-worker-*.js / manifest.json are excluded as
// their own top-level alternatives, NOT inside the file-extension group. In the
// previous matcher `sw\.js` sat inside the `.*\.(?:...)$` group, which is already
// prefixed by `\.`, so it only ever excluded paths ending in ".sw.js" — /sw.js
// itself still ran the middleware. That is harmless only while updateSession is
// a no-op passthrough; the moment it redirects unauthenticated requests, service
// worker registration would 302 to /login and ALL offline support would die.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|workbox-.*\\.js|swe-worker-.*\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

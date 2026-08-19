import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  BYPASS_FLAG,
  chromiumMajor,
  IS_LEGACY_BUILD,
  MIN_LEGACY_CHROME,
} from "@/lib/browserSupport";
import { upgradePageHtml } from "@/lib/upgradePage";

export async function middleware(request: NextRequest) {
  // Legacy deployment only: refuse browsers below the baseline with a plain
  // HTML page. Done here rather than in client JS because a browser this old
  // may not parse the app bundle at all — see src/lib/upgradePage.ts.
  //
  // API routes are left alone so the connectivity heartbeat and any queued
  // sync from an already-loaded tab keep working.
  if (IS_LEGACY_BUILD && !request.nextUrl.pathname.startsWith("/api/")) {
    const bypass = request.nextUrl.searchParams.get(BYPASS_FLAG) === "1";
    const major = chromiumMajor(request.headers.get("user-agent") || "");
    // major === 0 means "not Chromium" — do not block, we cannot judge it.
    if (!bypass && major > 0 && major < MIN_LEGACY_CHROME) {
      return new NextResponse(upgradePageHtml(major), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  }

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
    "/((?!_next/static|_next/image|favicon.ico|sw\.js|manifest\.json|workbox-.*\.js|swe-worker-.*\.js|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

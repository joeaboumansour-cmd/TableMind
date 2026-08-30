// =============================================
// Health Check Endpoint
// Used by the connectivity heartbeat to determine
// real internet connectivity. Returns 200 when the
// server is reachable.
// =============================================

import { NextResponse } from "next/server";

/**
 * Edge, not Node.
 *
 * This is the most-called endpoint in the product by a wide margin: every open
 * tab probes it every 15 seconds, all day, in every shop — plus once on every
 * app launch, every foreground, and every `online` event. It returns a
 * two-field JSON object and touches nothing.
 *
 * As a Node serverless function it paid a full invocation for that, cold start
 * included, and was measured at 195-204 ms warm — the RTT floor for the whole
 * app. The Edge runtime has effectively no cold start and runs at the PoP
 * nearest the shop rather than in the function region, which is the difference
 * between a probe that answers before the boot burst is over and one that
 * loses the race and paints "Offline". That race is exactly what made the
 * installed iOS PWA show an outage for ten seconds on launch (audit P2-17).
 *
 * Nothing here needs Node: no Supabase client, no service-role key, no
 * `cookies()`. Keep it that way — the moment this imports something that does,
 * it has to go back to Node and the heartbeat gets slow again.
 */
export const runtime = "edge";

/**
 * Never cached, anywhere. A cached 200 makes the app believe it is permanently
 * online: offline banners never appear and sync never fires on reconnect. The
 * service worker is kept off it by the NetworkOnly rule in next.config.ts
 * (asserted by scripts/verify-sw.mjs); this covers the browser HTTP cache and
 * any CDN in front of it.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", timestamp: Date.now() },
    {
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

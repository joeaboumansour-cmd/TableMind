// =============================================
// Health Check Endpoint
// Used by the connectivity heartbeat to determine
// real internet connectivity. Returns 200 when the
// server is reachable.
// =============================================

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: Date.now() });
}
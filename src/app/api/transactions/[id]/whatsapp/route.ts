// This endpoint has been removed.
// The "Send to WhatsApp" feature from transaction history was removed in favor
// of digital receipts delivered via scannable QR codes (see /receipt/[token]).
// The file is kept as a stub returning 404 so that any stale client requests
// or bookmarks fail gracefully instead of hitting removed database columns.

import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "This endpoint has been removed. Use the digital receipt QR code instead." },
    { status: 404 }
  );
}

export async function GET() {
  return NextResponse.json(
    { error: "This endpoint has been removed. Use the digital receipt QR code instead." },
    { status: 404 }
  );
}

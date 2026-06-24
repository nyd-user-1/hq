import { NextResponse } from "next/server";
import { getAllSessionsFull } from "@/lib/sessions";

export const dynamic = "force-dynamic";

// EVERY interactive transcript, enriched for the new-session picker table
// (full menu metadata + snippet/context/surface). Fetched on the picker's own
// cadence (open / focus / debounced change push) — NOT the 1s turns poll — so the
// per-file head+tail reads don't run every second. See lib/sessions.getAllSessionsFull.
export async function GET() {
  return NextResponse.json({ sessions: getAllSessionsFull() });
}

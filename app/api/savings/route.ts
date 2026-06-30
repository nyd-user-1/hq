import { NextResponse } from "next/server";
import { getUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

// The Savings panel's HTTP face. GET → the one number the panel needs: how many
// tokens were read from the prompt cache in the last 7 days (the "Week" window
// of getUsage()). node:fs stays server-side; the client fetches this on open.
// Everything else the panel shows (the levers, the roadmap, the $ assumptions)
// is static copy, so it lives in the client, not here.
export function GET() {
  const { windows, generatedAt } = getUsage();
  const week = windows.find((w) => w.label.startsWith("Week"));
  return NextResponse.json({
    cacheRead: week?.totals.cacheRead ?? 0,
    generatedAt,
  });
}

import { NextResponse } from "next/server";
import { getRecentSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

// Recent sessions for the sidebar Recents list (Claude-style). Keeps node:fs
// server-side; the client SidebarRecents polls this.
export async function GET() {
  return NextResponse.json({ sessions: getRecentSessions(24) });
}

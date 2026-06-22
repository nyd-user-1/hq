import { NextResponse } from "next/server";
import { getRecentSessions } from "@/lib/sessions";
import { chainRootMap } from "@/lib/lineage";

export const dynamic = "force-dynamic";

// Recent sessions for the sidebar Recents list (Claude-style). Keeps node:fs
// server-side; the client SidebarRecents polls this. Chain roots are merged here
// (not in sessions.ts) so lib/sessions doesn't import lib/lineage — which already
// imports lib/sessions — avoiding a cycle.
export async function GET() {
  const sessions = getRecentSessions(24);
  const roots = chainRootMap();
  for (const s of sessions) s.chainRoot = roots.get(s.id) ?? s.id;
  return NextResponse.json({ sessions });
}

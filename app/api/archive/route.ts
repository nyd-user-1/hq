import { NextResponse } from "next/server";
import { getArchiveSessions, searchArchive, warmIndex } from "@/lib/archive";

export const dynamic = "force-dynamic";

// Session Archive: all sessions (newest first) or, with ?q=, the ones whose
// transcript matches — ranked by hit count. Keeps node:fs server-side.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const all = getArchiveSessions();

  if (!q) {
    // No query yet → start warming the search index in the background so the
    // first real search is instant.
    warmIndex();
    return NextResponse.json({ query: "", total: all.length, sessions: all });
  }

  const { hits, building } = searchArchive(q);
  const matched = all
    .filter((s) => hits.has(s.id))
    .map((s) => ({ ...s, hits: hits.get(s.id) }))
    .sort((a, b) => (b.hits ?? 0) - (a.hits ?? 0) || b.lastActive - a.lastActive);

  return NextResponse.json({
    query: q,
    total: all.length,
    matched: matched.length,
    building, // index not ready yet / refresh in flight → UI shows "indexing"
    sessions: matched,
  });
}

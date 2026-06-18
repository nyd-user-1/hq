import { NextResponse } from "next/server";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";

// Client-callable universal search — the ⌘K palette debounce-queries this as you
// type. Thin wrapper over lib/search `search()` (the same engine the /search
// panel renders server-side); kept here so the palette never imports lib/search
// directly (it pulls node:fs). Always scope "all", newest-first, small limit —
// the palette shows a preview; the full /search page is the deep dive.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 8));
  if (!q) return NextResponse.json({ hits: [], building: false });
  const { hits, building } = search(q, "all", "new", limit);
  return NextResponse.json({ hits, building });
}

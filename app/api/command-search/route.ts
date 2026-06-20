import { NextResponse } from "next/server";
import { search, type SearchScope, type SearchHit } from "@/lib/search";
import { warmDocs } from "@/lib/docs";

export const dynamic = "force-dynamic";

// The ⌘K palette's search — corpus-BALANCED. `/api/search` returns the N newest
// hits across all corpora merged, which lets recent transcripts/commits crowd the
// quieter corpora (the Claude docs mirror especially) out of the top of the list
// (repro: q="session" / q="search" return zero docs). The palette is now HQ's
// primary search, so it must reliably reach EVERY corpus. We query each corpus for
// its top few and interleave them — best-of-each-corpus first, Docs near the front
// — so the first screenful spans corpora rather than burying them. Same
// {hits, building} shape as /api/search, so the palette renders unchanged.
// warmDocs() keeps the offline docs mirror fresh in this path (the /search page
// warmed it before; the palette must too).

// Interleave priority — most-likely-wanted corpora first; Docs sits at #2 so the
// offline best-practice oracle is always near the top of the results.
const ORDER: SearchScope[] = [
  "transcripts",
  "docs",
  "files",
  "sessions",
  "commits",
  "components",
  "todos",
  "memory",
  "notes",
  "skills",
  "projects",
  "scripts",
  "sdk",
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 120));
  if (!q) return NextResponse.json({ hits: [], building: false });

  warmDocs(); // keep the docs mirror fresh in the palette path too

  const PER = 25; // hits pulled per corpus — deep enough to lazy-load through, balanced by the interleave
  let building = false;
  const buckets = ORDER.map((scope) => {
    const { hits, building: b } = search(q, scope, "new", PER);
    if (b) building = true;
    return hits;
  });

  // Round-robin: one (best) hit from each matching corpus first, then seconds.
  // Guarantees a corpus with a real match is never blanked by a busier one.
  const hits: SearchHit[] = [];
  for (let pass = 0; pass < PER; pass++) {
    for (const bucket of buckets) {
      if (bucket[pass]) hits.push(bucket[pass]);
    }
  }

  return NextResponse.json({ hits: hits.slice(0, limit), building });
}

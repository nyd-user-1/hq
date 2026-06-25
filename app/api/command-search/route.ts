import { NextResponse } from "next/server";
import {
  search,
  recent,
  queryTokens,
  metadataCorpus,
  type SearchScope,
  type SearchHit,
  type CorpusItem,
} from "@/lib/search";
import { warmDocs } from "@/lib/docs";
import { fuzzyMatch } from "@/lib/fuzzy";

export const dynamic = "force-dynamic";

// The ⌘K palette's search — corpus-balanced AND relevance-ranked. `/api/search`
// returns the N NEWEST hits across all corpora merged, which (a) lets recent
// transcripts/commits crowd the quieter corpora — the Claude docs mirror
// especially — out of the top, and (b) ranks a typed query by recency, not by
// match quality. The palette is HQ's primary search, so it must reach EVERY
// corpus AND put the best match first.
//
// Approach — the local-search consensus (relevance per corpus, fused with
// Reciprocal Rank Fusion), the recipe qmd / GitNexus / mem0 all converge on,
// done in-process with zero new deps:
//   1. Query each corpus for its top matches RANKED BY RELEVANCE (sort="rel"),
//      not recency.
//   2. Fuse across corpora with RRF — score = 1/(K + rank) — times a gentle
//      corpus-priority weight (Docs near the front), so a corpus with a real
//      match is never blanked by a busier one.
//   3. Tier the merge: exact-title > title-prefix > contains/phrase > scattered,
//      so an exact match is always #1 (qmd's exact-match preservation), with RRF
//      breaking ties inside each tier.
// Same {hits, building} shape as /api/search, so the palette renders unchanged.
// warmDocs() keeps the offline docs mirror fresh in this path too.

// Corpus priority — most-likely-wanted first; Docs at #2 so the offline
// best-practice oracle stays near the top. The index also drives the RRF corpus
// weight (earlier = a slightly higher multiplier).
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

const RRF_K = 60; // Reciprocal Rank Fusion constant (qmd uses k=60)
const PER = 25; // hits pulled per corpus — deep enough to lazy-load through

// Relevance tier from how the query matches the title (lower = better). Exact
// title and prefix are what a user almost always means; a contiguous-phrase hit
// (already narrowed per-corpus by lib/search) outranks scattered tokens.
// Kinds whose `ref` IS a filename/path — dropping that exact name should surface
// the file above everything. memory/note/script keep the extension on `ref`
// ("hq-product-description.md") while their title drops it, so match on ref too.
const FILE_KINDS = new Set(["file", "memory", "note", "script", "doc"]);

function tier(h: SearchHit, ql: string): number {
  const title = h.title.toLowerCase();
  // An exact file-name (or path) match floats to a top tier — above even a
  // coincidental exact-title match in another corpus. Strip a trailing :line[:col]
  // so a chip dropped verbatim ("components.ts:97") still counts.
  if (FILE_KINDS.has(h.kind)) {
    const fileQl = ql.replace(/(\.[a-z0-9]+):\d+(:\d+)?$/i, "$1");
    if (h.ref.toLowerCase() === fileQl || title === fileQl) return -1;
  }
  if (title === ql) return 0;
  if (title.startsWith(ql)) return 1;
  if (title.includes(ql) || h.phrase) return 2;
  return 3;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 120));
  // Scope filter (⌘K chip / "/file " prefix): restrict to one corpus, or "all".
  const reqScope = searchParams.get("scope") ?? "all";
  const scoped = reqScope !== "all" && ORDER.includes(reqScope as SearchScope);
  const order = scoped ? [reqScope as SearchScope] : ORDER;
  // Empty query: a browse, never blank. A scope chip browses that whole corpus
  // newest-first; unscoped "all" shows a CROSS-CORPUS recents feed (recent("all")
  // — transcripts/sessions/memory/notes/todos/commits by recency). The command
  // launcher lives in MENU now, so an empty "All" is a recency browse, not a void.
  if (!q)
    return NextResponse.json({
      hits: recent(reqScope as SearchScope, "new", limit),
      building: false,
    });

  warmDocs(); // keep the docs mirror fresh in the palette path too
  const ql = q.toLowerCase();

  let building = false;
  type Ranked = { hit: SearchHit; tier: number; score: number };
  const ranked: Ranked[] = [];

  order.forEach((scope, ci) => {
    // A single-corpus chip view is a recency feed (newest first), so pull the
    // NEWEST matches at full depth; the unscoped "all" search stays relevance-
    // ranked + corpus-balanced.
    const { hits, building: b } = search(q, scope, scoped ? "new" : "rel", scoped ? limit : PER);
    if (b) building = true;
    // Gentle corpus-priority weight: top corpus ~1.46 → last ~1.0. It nudges,
    // never dominates — an exact-title match in a low-priority corpus still wins
    // via its tier.
    const weight = 1 + ((ORDER.length - ci - 1) / ORDER.length) * 0.5;
    hits.forEach((hit, rank) => {
      ranked.push({ hit, tier: tier(hit, ql), score: (1 / (RRF_K + rank)) * weight });
    });
  });

  // Scoped: a recency feed — newest last-activity first, with an exact filename
  // match still pinned to the very top. Unscoped: tier (exact > prefix > phrase >
  // scattered) then RRF score. Dedupe by kind+ref, keeping the first (best) one.
  ranked.sort((a, b) =>
    scoped
      ? (a.tier === -1 ? 0 : 1) - (b.tier === -1 ? 0 : 1) || b.hit.at - a.hit.at
      : a.tier - b.tier || b.score - a.score,
  );
  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const r of ranked) {
    const key = `${r.hit.kind}:${r.hit.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(r.hit);
    if (hits.length >= limit) break;
  }

  // Typo tolerance: the exact pass (substring/token) can't find a misspelling —
  // "comand" never reaches command-palette. Run a bounded fuzzy pass over the
  // small named-thing corpora (sessions/components/todos/projects/skills/memory/
  // notes) and append the near-matches the exact pass didn't already surface,
  // ranked BELOW the exact hits (typo recoveries, not primary results). d > 0
  // keeps it to genuine misspellings — clean substring matches are the server's
  // job above. Cheap; transcripts/docs fuzzy is the Phase-2 trigram index.
  const toks = queryTokens(q);
  if (!scoped && toks.length && hits.length < limit) {
    const fz: { item: CorpusItem; d: number }[] = [];
    for (const item of metadataCorpus()) {
      const key = `${item.kind}:${item.ref}`;
      if (seen.has(key)) continue;
      const d = fuzzyMatch(toks, item.title);
      if (d !== null && d > 0) fz.push({ item, d });
    }
    fz.sort((a, b) => a.d - b.d || b.item.at - a.item.at);
    for (const { item } of fz) {
      if (hits.length >= limit) break;
      hits.push({
        kind: item.kind,
        ref: item.ref,
        title: item.title,
        snippet: "",
        at: item.at,
        score: 0,
        phrase: false,
        meta: item.meta,
      });
    }
  }

  return NextResponse.json({ hits, building });
}

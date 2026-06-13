import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import Markdown from "@/app/ui/md";
import SearchInput from "@/app/ui/search-input";
import RefreshWhile from "@/app/ui/refresh-while";
import { ago } from "@/lib/ago";
import {
  search,
  getMemoryFile,
  queryTokens,
  type SearchScope,
} from "@/lib/search";

export const dynamic = "force-dynamic";

// Wrap every hit of the first query token in a <mark> so the snippet shows
// WHY it matched.
function highlight(text: string, tok: string): React.ReactNode {
  if (!tok) return text;
  const lower = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (let j = lower.indexOf(tok); j !== -1; j = lower.indexOf(tok, i)) {
    if (j > i) out.push(text.slice(i, j));
    out.push(
      <mark key={k++} className="rounded-sm bg-blue-500/30 px-0.5 text-zinc-100">
        {text.slice(j, j + tok.length)}
      </mark>
    );
    i = j + tok.length;
  }
  out.push(text.slice(i));
  return out;
}

// Search over everything HQ can see: transcripts + memory. Result click —
// transcript: pin that session in the terminal (/sessions?session=<id>);
// memory: open the .md right here (?open=<file>).
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string; open?: string }>;
}) {
  const { q = "", scope: rawScope, open } = await searchParams;
  const scope: SearchScope =
    rawScope === "transcripts" || rawScope === "memory" ? rawScope : "all";

  // ── opened memory file ──────────────────────────────────────────────────
  if (open) {
    const content = getMemoryFile(open);
    const back = `/search?q=${encodeURIComponent(q)}&scope=${scope}`;
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <span className="truncate font-mono text-xs text-zinc-500">
            memory/{open}
          </span>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto text-sm">
          {content ? (
            <Markdown text={content} />
          ) : (
            <p className="text-xs text-zinc-600">memory file not found</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── query + results ─────────────────────────────────────────────────────
  const { hits, building } = search(q, scope);
  const tok = queryTokens(q)[0] ?? "";

  const scopeChip = (label: string, value: SearchScope) => (
    <Link
      key={value}
      href={`/search?q=${encodeURIComponent(q)}&scope=${value}`}
      scroll={false}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        scope === value
          ? "bg-blue-600 text-white"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <Boundary label="@panel/search/page.tsx">
      <div className="flex flex-col gap-2">
        <SearchInput initial={q} scope={scope} />
        <div className="flex gap-2">
          {scopeChip("All", "all")}
          {scopeChip("Transcripts", "transcripts")}
          {scopeChip("Memory", "memory")}
        </div>
      </div>

      <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {hits.map((h) => (
          <li key={`${h.kind}:${h.ref}`}>
            <Link
              href={
                h.kind === "transcript"
                  ? `/sessions?session=${h.ref}`
                  : `/search?q=${encodeURIComponent(q)}&scope=${scope}&open=${encodeURIComponent(h.ref)}`
              }
              scroll={false}
              className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    h.kind === "memory"
                      ? "bg-violet-500/15 text-violet-300"
                      : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {h.kind}
                </span>
                <span className="truncate text-sm font-medium text-zinc-200">
                  {h.title}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">
                  {ago(h.at)}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {highlight(h.snippet, tok)}
              </p>
            </Link>
          </li>
        ))}
        {q && hits.length === 0 && (
          <li className="text-xs text-zinc-600">
            {building ? "building the search index (first time, ~10s)…" : "no matches"}
          </li>
        )}
      </ul>
      <p className="text-xs text-zinc-600">
        every session ever + memory · transcript → opens in the terminal ·
        memory → opens the note
        {building && <span className="text-amber-400"> · indexing…</span>}
      </p>
      <RefreshWhile active={building} />
    </Boundary>
  );
}

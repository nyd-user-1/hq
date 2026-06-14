import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import Markdown from "@/app/ui/md";
import SearchInput from "@/app/ui/search-input";
import RefreshWhile from "@/app/ui/refresh-while";
import CopyText from "@/app/ui/copy-text";
import { ago } from "@/lib/ago";
import { turnsFor } from "@/lib/transcript";
import {
  search,
  recent,
  getMemoryFile,
  memoryFilePath,
  queryTokens,
  type SearchScope,
  type SortDir,
} from "@/lib/search";

export const dynamic = "force-dynamic";

// Mark WHY a snippet matched. Prefer the contiguous phrase — the query tokens
// in order with any punctuation/whitespace between them — so "wow..you did it"
// lights up as one span. If the phrase isn't contiguous here (the AND-of-tokens
// fallback case), mark each token instead. Tokens are normalized (lowercase,
// alphanumeric) so the joined pattern needs no escaping.
function highlight(text: string, query: string): React.ReactNode {
  const toks = queryTokens(query);
  if (toks.length === 0) return text;

  let ranges: [number, number][] = [];
  const phraseRe = new RegExp(toks.join("[^a-z0-9]+"), "ig");
  for (let m = phraseRe.exec(text); m; m = phraseRe.exec(text)) {
    ranges.push([m.index, m.index + m[0].length]);
    if (m.index === phraseRe.lastIndex) phraseRe.lastIndex++; // guard zero-width
  }
  if (ranges.length === 0) {
    const lower = text.toLowerCase();
    for (const t of toks)
      for (let p = lower.indexOf(t); p !== -1; p = lower.indexOf(t, p + t.length))
        ranges.push([p, p + t.length]);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    ranges = merged;
  }

  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (const [s, e] of ranges) {
    if (s > i) out.push(text.slice(i, s));
    out.push(
      <mark key={k++} className="rounded-sm bg-blue-500/30 px-0.5 text-zinc-100">
        {text.slice(s, e)}
      </mark>
    );
    i = e;
  }
  out.push(text.slice(i));
  return out;
}

// Sort-direction glyph (no icon lib in HQ): bars + an arrow that points down for
// newest-first (default) and up for oldest-first.
function SortIcon({ dir }: { dir: SortDir }) {
  const arrow =
    dir === "new" ? (
      <>
        <path d="M6 5v13" />
        <path d="m3 15 3 3 3-3" />
      </>
    ) : (
      <>
        <path d="M6 19V6" />
        <path d="m3 9 3-3 3 3" />
      </>
    );
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 6h9" />
      <path d="M12 11h6" />
      <path d="M12 16h3" />
      {arrow}
    </svg>
  );
}

// Search over everything HQ can see: transcripts + memory. Result click —
// transcript: pin that session in the terminal (/sessions?session=<id>);
// memory: open the .md right here (?open=<file>).
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    scope?: string;
    sort?: string;
    open?: string;
    openSession?: string;
  }>;
}) {
  const { q = "", scope: rawScope, sort: rawSort, open, openSession } = await searchParams;
  const scope: SearchScope =
    rawScope === "transcripts" || rawScope === "memory" ? rawScope : "all";
  const sortDir: SortDir = rawSort === "old" ? "old" : "new";
  const back = `/search?q=${encodeURIComponent(q)}&scope=${scope}&sort=${sortDir}`;

  // ── opened memory file ──────────────────────────────────────────────────
  if (open) {
    const content = getMemoryFile(open);
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <CopyText
            text={memoryFilePath(open)}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            memory/{open}
          </CopyText>
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

  // ── opened transcript ───────────────────────────────────────────────────
  // The clicked transcript opens HERE (in the panel, like a memory note) rather
  // than hijacking the terminal. Clean user/assistant text only — no tool noise.
  if (openSession) {
    const { turns, project } = turnsFor(openSession, 250);
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <CopyText
            text={`claude --resume ${openSession}`}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            {project || "session"} · {openSession.slice(0, 8)}
          </CopyText>
        </div>
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-sm">
          {turns.length === 0 ? (
            <p className="text-xs text-zinc-600">transcript not found</p>
          ) : (
            turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-1">
                <span
                  className={`font-mono text-[10px] uppercase tracking-wide ${
                    t.role === "user" ? "text-blue-400" : "text-emerald-400"
                  }`}
                >
                  {t.role === "user" ? "you" : "claude"}
                </span>
                <div className="text-zinc-300">
                  <Markdown text={t.text} />
                </div>
              </div>
            ))
          )}
        </div>
      </Boundary>
    );
  }

  // ── query + results ─────────────────────────────────────────────────────
  // No query → browse the most-recent transcripts + memory as cards (honors the
  // scope chips + sort toggle). With a query → ranked search hits.
  const { hits, building } = q
    ? search(q, scope, sortDir)
    : { hits: recent(scope, sortDir), building: false };

  const scopeChip = (label: string, value: SearchScope) => (
    <Link
      key={value}
      href={`/search?q=${encodeURIComponent(q)}&scope=${value}&sort=${sortDir}`}
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
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {scopeChip("All", "all")}
          {scopeChip("Transcripts", "transcripts")}
          {scopeChip("Memory", "memory")}
          <Link
            href={`/search?q=${encodeURIComponent(q)}&scope=${scope}&sort=${
              sortDir === "new" ? "old" : "new"
            }`}
            scroll={false}
            aria-label="Toggle sort order"
            title={
              sortDir === "new"
                ? "Newest first — click for oldest"
                : "Oldest first — click for newest"
            }
            className="ml-auto flex shrink-0 items-center rounded-md bg-zinc-800 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <SortIcon dir={sortDir} />
          </Link>
        </div>
        <SearchInput initial={q} scope={scope} sort={sortDir} />
      </div>

      {!q && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          recent · newest first
        </p>
      )}

      <ul className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
        {hits.map((h) => (
          <li key={`${h.kind}:${h.ref}`}>
            <Link
              href={
                h.kind === "transcript"
                  ? `${back}&openSession=${h.ref}`
                  : `${back}&open=${encodeURIComponent(h.ref)}`
              }
              scroll={false}
              className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
            >
              <div className="flex items-center gap-2.5">
                <span className="min-w-0 truncate text-sm font-medium text-zinc-200">
                  {h.title}
                </span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {ago(h.at)}
                </span>
                <span
                  className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                    h.kind === "memory"
                      ? "bg-violet-500/15 text-violet-300"
                      : "bg-emerald-500/15 text-emerald-300"
                  }`}
                >
                  {h.kind}
                </span>
              </div>
              {h.snippet && (
                <p className="break-words text-xs text-zinc-400">
                  {highlight(h.snippet, q)}
                </p>
              )}
            </Link>
          </li>
        ))}
        {hits.length === 0 && (
          <li className="text-xs text-zinc-600">
            {building
              ? "building the search index (first time, ~10s)…"
              : q
                ? "no matches"
                : "nothing here yet"}
          </li>
        )}
      </ul>
      <p className="text-xs text-zinc-600">
        every session ever + memory · click a result to read it here · paths +
        resume commands copy on click
        {building && <span className="text-amber-400"> · indexing…</span>}
      </p>
      <RefreshWhile active={building} />
    </Boundary>
  );
}

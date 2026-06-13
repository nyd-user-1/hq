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
  getMemoryFile,
  memoryFilePath,
  corpusCounts,
  queryTokens,
  type SearchScope,
} from "@/lib/search";

export const dynamic = "force-dynamic";

// Demonstrative starter queries (swappable): integrations, infra, a concept,
// and the words that surface parked decisions / DB work across all projects.
const EXAMPLES = [
  "stripe",
  "neon auth",
  "design system",
  "vercel",
  "deferred",
  "schema migration",
];

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
  searchParams: Promise<{
    q?: string;
    scope?: string;
    open?: string;
    openSession?: string;
  }>;
}) {
  const { q = "", scope: rawScope, open, openSession } = await searchParams;
  const scope: SearchScope =
    rawScope === "transcripts" || rawScope === "memory" ? rawScope : "all";
  const back = `/search?q=${encodeURIComponent(q)}&scope=${scope}`;

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
  const { hits, building } = search(q, scope);
  const tok = queryTokens(q)[0] ?? "";
  const counts = q ? { sessions: 0, memory: 0 } : corpusCounts();

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

      {!q ? (
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pt-1">
          <p className="text-sm text-zinc-400">
            Search every Claude Code session you&apos;ve ever run — and the notes
            Claude keeps about your work.
          </p>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2.5">
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300">
                transcript
              </span>
              <span className="text-xs text-zinc-500">
                every message of every session — all projects, all time
              </span>
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-violet-300">
                memory
              </span>
              <span className="text-xs text-zinc-500">
                Claude&apos;s notes about you and each project
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              try
            </span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <Link
                  key={ex}
                  href={`/search?q=${encodeURIComponent(ex)}&scope=${scope}`}
                  scroll={false}
                  className="rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
                >
                  {ex}
                </Link>
              ))}
            </div>
          </div>

          <p className="mt-auto font-mono text-[11px] text-zinc-600">
            {counts.sessions} sessions · {counts.memory} memory notes
          </p>
        </div>
      ) : (
        <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
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
      )}
      <p className="text-xs text-zinc-600">
        every session ever + memory · click a result to read it here · paths +
        resume commands copy on click
        {building && <span className="text-amber-400"> · indexing…</span>}
      </p>
      <RefreshWhile active={building} />
    </Boundary>
  );
}

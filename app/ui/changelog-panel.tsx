"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import SearchField from "@/app/ui/search-field";
import CopyText from "@/app/ui/copy-text";
import { useChangelog } from "@/app/ui/changelog-state";
import type { Change } from "@/lib/changelog";

// Strip a conventional-commit prefix ("type(scope)!: ") and capitalize.
function humanSubject(subject: string): string {
  const m = subject.match(/^[a-z]+(?:\([^)]+\))?(?:!)?:\s*(.+)$/i);
  const s = m ? m[1].trim() : subject;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const baseName = (f: string) => f.split("/").pop() || f;
const FILE_SHOWN = 6;
// Real date + time (not relative); explicit en-US options so SSR + client agree.
function fmtWhen(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Diff = { repo: string; sha: string; text: string };

// Copy glyph (HQ has no icon lib): the standard two-rectangle clipboard mark.
// Inherits currentColor, so CopyText's emerald flash applies on copy.
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// Color a `git show` line by its diff role (same vocabulary as Shipped's reader).
function DiffLine({ line }: { line: string }) {
  let cls = "text-zinc-400";
  let edge = "border-transparent";
  if (line.startsWith("commit ") || line.startsWith("Author:") || line.startsWith("Date:")) cls = "text-zinc-500";
  else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) cls = "text-zinc-600";
  else if (line.startsWith("@@")) cls = "text-cyan-400";
  else if (line.startsWith("+")) { cls = "bg-emerald-500/15 text-emerald-200"; edge = "border-emerald-400/70"; }
  else if (line.startsWith("-")) { cls = "bg-red-500/30 text-red-200"; edge = "border-red-400/70"; }
  return (
    <div className={`whitespace-pre-wrap break-words border-l-2 ${edge} py-0.5 pl-[2ch] pr-1 [text-indent:-2ch] ${cls}`}>
      {line || " "}
    </div>
  );
}

// The Changelog panel — the cross-project commit timeline as a card list, in a
// standalone toggle panel (its own portal root #changelog-panel-root), mirroring
// the Plugins panel: AppPanel chrome, a live /api/changelog fetch. A card opens
// that commit's diff IN the panel (drill-down + back), never leaving it.
export default function ChangelogPanel() {
  const { open, setOpen, target, clearTarget } = useChangelog();
  const [items, setItems] = useState<Change[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  // repo optional: a chat-reply sha (CommitLink) drills by sha alone → findCommit.
  const [sel, setSel] = useState<{ repo?: string; sha: string } | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/changelog", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setItems(d.items ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Deep-link: a chat-reply sha (CommitLink.openAt) opens the panel AND drills
  // straight to that commit. Consume the target once so it doesn't re-fire.
  useEffect(() => {
    if (open && target) {
      setSel({ sha: target.sha, repo: target.repo });
      clearTarget();
    }
  }, [open, target, clearTarget]);

  // Drill-down: fetch the selected commit's diff (by repo+sha from a card, or by
  // sha alone from a chat-reply link → findCommit resolves the repo).
  useEffect(() => {
    if (!sel) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiff(null);
    const qs = sel.repo
      ? `repo=${encodeURIComponent(sel.repo)}&commit=${encodeURIComponent(sel.sha)}`
      : `commit=${encodeURIComponent(sel.sha)}`;
    fetch(`/api/changelog?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => !cancelled && setDiff(d.diff ?? null))
      .catch(() => !cancelled && setDiff(null))
      .finally(() => !cancelled && setDiffLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sel]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  const repos = useMemo(() => [...new Set(items.map((c) => c.repo))].sort(), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((c) => {
      if (repo && c.repo !== repo) return false;
      if (!needle) return true;
      return (
        c.sha.toLowerCase().includes(needle) ||
        c.subject.toLowerCase().includes(needle) ||
        c.summary.toLowerCase().includes(needle) ||
        c.repo.toLowerCase().includes(needle) ||
        c.files.some((f) => f.toLowerCase().includes(needle))
      );
    });
  }, [items, q, repo]);

  return (
    <AppPanel
      rootId="changelog-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="changelog-panel.tsx">
        {sel ? (
          // ── diff drill-down ──────────────────────────────────────────────
          <>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setSel(null)}
                className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
              >
                ← changelog
              </button>
              <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
                {(sel.repo ?? diff?.repo) ? `${sel.repo ?? diff?.repo} · ` : ""}
                {sel.sha}
              </span>
              {diff && (
                <CopyText
                  text={diff.text}
                  title="Copy full commit diff"
                  className="ml-auto shrink-0 text-zinc-500 hover:text-zinc-300"
                >
                  <CopyIcon />
                </CopyText>
              )}
            </div>
            <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-auto border-t border-zinc-800 pt-3 font-mono text-[11px] leading-snug">
              {diffLoading ? (
                <p className="text-xs text-zinc-600">loading…</p>
              ) : diff ? (
                diff.text.split("\n").map((l, i) => <DiffLine key={i} line={l} />)
              ) : (
                <p className="text-xs text-zinc-600">could not load this commit</p>
              )}
            </div>
          </>
        ) : (
          // ── feed ─────────────────────────────────────────────────────────
          <>
            <div className="flex shrink-0 items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">changelog</span>
              <button
                onClick={() => load()}
                disabled={loading}
                title="Refresh"
                aria-label="Refresh"
                className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
              >
                <svg
                  className={loading ? "animate-spin" : ""}
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </button>
            </div>

            {/* search + project filter — FIXED above the scroll area (shrink-0) */}
            <div className="flex shrink-0 items-center gap-2 pb-1">
              <div className="min-w-0 flex-1">
                <SearchField value={q} onChange={setQ} placeholder="Search changes, files…" />
              </div>
              <div ref={filterRef} className="relative shrink-0">
                <button
                  onClick={() => setFilterOpen((o) => !o)}
                  title="filter by project"
                  aria-haspopup="menu"
                  aria-expanded={filterOpen}
                  className="flex items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <span className="max-w-[80px] truncate">{repo ?? "Filter"}</span>
                </button>
                {filterOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-30 mt-1 flex max-h-64 w-44 flex-col overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
                  >
                    <button
                      onClick={() => {
                        setRepo(null);
                        setFilterOpen(false);
                      }}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                    >
                      <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">All</span>
                      {repo === null && <span className="ml-auto text-xs text-blue-400">✓</span>}
                    </button>
                    {repos.map((r) => (
                      <button
                        key={r}
                        onClick={() => {
                          setRepo((p) => (p === r ? null : r));
                          setFilterOpen(false);
                        }}
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                      >
                        <span className="min-w-0 truncate font-mono text-[11px] text-zinc-300">{r}</span>
                        {repo === r && <span className="ml-auto text-xs text-blue-400">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {err && (
              <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
                {err}
              </p>
            )}

            {/* the list OWNS the scroll (min-h-0 flex-1 overflow-y-auto) so it
                stays WITHIN the panel's dashed frame instead of spilling past it.
                The header + search above are shrink-0 and stay put. */}
            <ul className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
              {shown.map((c) => (
                <li key={`${c.repo}:${c.sha}`} className="relative">
                  {/* The rail line lives at the LI level (not inside the dot's
                      box) so it spans the FULL card height — the button's py-3
                      included — and adjacent LIs' lines touch into one unbroken
                      rail. Centered on the dot's x (left-[6px], the w-3 column's
                      midpoint). The dot's ring (page bg) punches a clean hole. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-[6px] w-px -translate-x-1/2 bg-zinc-700"
                  />
                  <button
                    onClick={() => setSel({ repo: c.repo, sha: c.sha })}
                    className="group/card relative flex w-full gap-3 rounded-md py-3 pr-1 text-left transition-colors hover:bg-zinc-800/30"
                  >
                    <span className="flex w-3 shrink-0 justify-center" aria-hidden>
                      <span className="mt-1.5 size-2 rounded-full bg-emerald-500 ring-4 ring-zinc-950" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-zinc-200">{humanSubject(c.subject)}</div>
                      {c.summary && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500">{c.summary}</p>
                      )}
                      {c.files.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {c.files.slice(0, FILE_SHOWN).map((f) => (
                            <code
                              key={f}
                              title={f}
                              className="max-w-[160px] truncate rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                            >
                              {baseName(f)}
                            </code>
                          ))}
                          {c.files.length > FILE_SHOWN && (
                            <span className="font-mono text-[10px] text-zinc-600">+{c.files.length - FILE_SHOWN}</span>
                          )}
                        </div>
                      )}
                      {/* footer: repo · sha · real date+time (wraps at narrow widths) */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-zinc-600">
                        <span>{c.repo}</span>
                        <span className="text-zinc-700">·</span>
                        <span>{c.sha}</span>
                        <span className="text-zinc-700">·</span>
                        <span suppressHydrationWarning>{fmtWhen(c.at)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
              {!shown.length && !loading && (
                <p className="font-mono text-[11px] text-zinc-600">
                  {q || repo ? "no changes match this filter" : "no git repos under ~/code"}
                </p>
              )}
            </ul>
          </>
        )}
      </Boundary>
    </AppPanel>
  );
}

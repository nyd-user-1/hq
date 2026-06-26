"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import Markdown from "@/app/ui/md";
import { useCommands } from "@/app/ui/commands-state";
import type { LibraryCommand } from "@/lib/commands-library";

// hq's Commands panel — sibling of the Skills panel, cloned from the same shape.
// ONE surface over every slash command: "Yours" = ~/.claude/commands; "Library" =
// the harness built-ins (the CLI registry) plus commands shipped by your enabled
// plugins, filtered by source. Click a card to drill in (full description + the
// command file when there is one). Commands are CLI controls you type, so the
// action is Copy (loads /name to your clipboard), not auto-run.

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export default function CommandsPanel() {
  const { open, setOpen } = useCommands();
  const [commands, setCommands] = useState<LibraryCommand[]>([]);
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<LibraryCommand | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/commands", { cache: "no-store" }).then((res) => res.json());
      setCommands(r?.commands ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const query = q.trim().toLowerCase();
  const matchesQuery = useCallback(
    (c: LibraryCommand) =>
      !query ||
      c.name.toLowerCase().includes(query) ||
      c.description.toLowerCase().includes(query) ||
      c.sourceLabel.toLowerCase().includes(query),
    [query],
  );

  const yours = commands.filter((c) => c.source === "user" && matchesQuery(c));
  const pool = commands.filter((c) => c.source !== "user");

  const sources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of pool) counts[c.sourceLabel] = (counts[c.sourceLabel] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [pool]);

  const library = pool
    .filter((c) => (src === "all" || c.sourceLabel === src) && matchesQuery(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <AppPanel
      rootId="commands-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="commands-panel.tsx">
        {selected ? (
          <div className="flex shrink-0 items-center">
            <button
              onClick={() => setSelected(null)}
              title="Back to commands"
              aria-label="Back"
              className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="min-w-0 truncate font-mono text-[11px] text-zinc-100">/{selected.name}</span>
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={commands.length ? `Search ${commands.length} commands…` : "Search commands…"}
              className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <button
              onClick={() => load()}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              <svg className={loading ? "animate-spin" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          </div>
        )}

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {selected ? (
          <CommandDetailView cmd={selected} />
        ) : (
          <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
            {/* YOURS */}
            <SectionLabel label="Yours" count={commands.filter((c) => c.source === "user").length} />
            <div className="mt-2 flex flex-col gap-4">
              {yours.length ? (
                yours.map((c) => <CommandCard key={c.id} c={c} onOpen={setSelected} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {query ? "no commands of yours match." : "No commands under ~/.claude/commands yet."}
                </p>
              )}
            </div>

            <div className="sticky top-0 z-10 mt-6 bg-[#09090b] pb-4 pt-1">
              <SectionLabel label="Library" count={pool.length} />
              <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto overscroll-x-contain">
                <SrcChip label="all" count={pool.length} active={src === "all"} onClick={() => setSrc("all")} />
                {sources.map(([s, n]) => (
                  <SrcChip key={s} label={s} count={n} active={src === s} onClick={() => setSrc(s)} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {library.length ? (
                library.map((c) => <CommandCard key={c.id} c={c} onOpen={setSelected} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {loading ? "loading…" : query ? `no commands match “${q}”.` : "nothing here."}
                </p>
              )}
            </div>
          </div>
        )}

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {selected
            ? "Copy loads /name to your clipboard — paste it into the terminal to run."
            : `${commands.length} commands · built-in, yours, and plugin-shipped. Click one to open it.`}
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex shrink-0 items-baseline gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-zinc-600">{count}</span>
    </div>
  );
}

function SrcChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
        active
          ? "border-zinc-200 bg-zinc-200 text-zinc-900"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${active ? "text-zinc-500" : "text-zinc-600"}`}>{count}</span>
    </button>
  );
}

function CommandMeta({ c }: { c: LibraryCommand }) {
  if (c.source === "builtin") {
    return <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">built-in</span>;
  }
  return <span className="font-mono text-[10px] text-zinc-600">~{fmt(c.tokens)} tok</span>;
}

function CommandCard({ c, onOpen }: { c: LibraryCommand; onOpen: (c: LibraryCommand) => void }) {
  const dot = c.source === "user" ? "text-blue-500" : c.source === "builtin" ? "text-zinc-500" : "text-emerald-500";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(c)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(c);
        }
      }}
      className="cursor-pointer rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className={`shrink-0 text-[10px] leading-none ${dot}`} aria-hidden>●</span>
          <span className="truncate font-mono text-[13px] text-zinc-200">/{c.name}</span>
        </span>
        <span className="shrink-0">
          <CommandMeta c={c} />
        </span>
      </div>

      <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">{c.sourceLabel}</div>

      {c.description && (
        <p className="mt-3 line-clamp-2 text-[11px] leading-snug text-zinc-500">{c.description}</p>
      )}
    </div>
  );
}

function CommandDetailView({ cmd: c }: { cmd: LibraryCommand }) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!c.path) {
      setBody(null);
      return;
    }
    let abort = false;
    setLoading(true);
    setBody(null);
    fetch(`/api/commands/doc?path=${encodeURIComponent(c.path)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!abort) setBody(d?.body ?? null);
      })
      .catch(() => {
        if (!abort) setBody(null);
      })
      .finally(() => {
        if (!abort) setLoading(false);
      });
    return () => {
      abort = true;
    };
  }, [c.path]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`/${c.name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-mono text-[11px]">
          <span className="text-zinc-400">{c.sourceLabel}</span>
          <span className="text-zinc-700"> · </span>
          <CommandMeta c={c} />
        </div>
        <button
          type="button"
          onClick={copy}
          title={`Copy /${c.name}`}
          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {c.argHint && (
        <div className="font-mono text-[11px] text-zinc-500">
          Usage <span className="text-zinc-300">/{c.name} {c.argHint}</span>
        </div>
      )}

      {c.description && <p className="text-[12px] leading-relaxed text-zinc-300">{c.description}</p>}

      {!c.path ? (
        <p className="border-t border-dashed border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
          Built-in — part of the CLI, no file to show. Type it in the terminal.
        </p>
      ) : loading ? (
        <p className="font-mono text-[11px] text-zinc-600">loading…</p>
      ) : body ? (
        <div className="border-t border-dashed border-zinc-800 pt-4 text-[13px] leading-relaxed text-zinc-300">
          <Markdown text={body} />
        </div>
      ) : null}
    </div>
  );
}

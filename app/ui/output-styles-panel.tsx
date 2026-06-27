"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import Markdown from "@/app/ui/md";
import { useOutputStyles } from "@/app/ui/output-styles-state";
import type { LibraryStyle } from "@/lib/output-styles";

// hq's Output Styles panel — sibling of the Skills / Commands panels, same shape.
// ONE surface over every output style you can switch to: "Yours" =
// ~/.claude/output-styles; "Library" = the built-ins (default · Explanatory ·
// Learning) plus styles shipped by enabled plugins, filtered by source. Click a
// card to drill in (the full style body — the system-prompt adjustment it
// applies). The action is Apply, which loads /output-style <name> into the
// terminal — hit enter to switch.

// Load a command into the terminal send box (Terminal 1), focused.
function prefill(cmd: string) {
  window.dispatchEvent(
    new CustomEvent("hq:compose", { detail: { text: cmd, replace: true, focus: true } }),
  );
}

export default function OutputStylesPanel() {
  const { open, setOpen } = useOutputStyles();
  const [styles, setStyles] = useState<LibraryStyle[]>([]);
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<LibraryStyle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/output-styles", { cache: "no-store" }).then((res) => res.json());
      setStyles(r?.styles ?? []);
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
    (s: LibraryStyle) =>
      !query ||
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.sourceLabel.toLowerCase().includes(query),
    [query],
  );

  const yours = styles.filter((s) => s.source === "user" && matchesQuery(s));
  const pool = styles.filter((s) => s.source !== "user");

  const sources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of pool) counts[s.sourceLabel] = (counts[s.sourceLabel] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [pool]);

  const library = pool
    .filter((s) => (src === "all" || s.sourceLabel === src) && matchesQuery(s))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <AppPanel
      rootId="output-styles-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="output-styles-panel.tsx">
        {selected ? (
          <div className="flex shrink-0 items-center">
            <button
              onClick={() => setSelected(null)}
              title="Back to styles"
              aria-label="Back"
              className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="min-w-0 truncate font-mono text-[11px] text-zinc-100">{selected.name}</span>
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={styles.length ? `Search ${styles.length} styles…` : "Search styles…"}
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
          <StyleDetailView style={selected} />
        ) : (
          <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
            {/* YOURS */}
            <SectionLabel label="Yours" count={styles.filter((s) => s.source === "user").length} />
            <div className="mt-2 flex flex-col gap-4">
              {yours.length ? (
                yours.map((s) => <StyleCard key={s.id} s={s} onOpen={setSelected} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {query ? "no styles of yours match." : "No styles under ~/.claude/output-styles yet."}
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
                library.map((s) => <StyleCard key={s.id} s={s} onOpen={setSelected} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {loading ? "loading…" : query ? `no styles match “${q}”.` : "nothing here."}
                </p>
              )}
            </div>
          </div>
        )}

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {selected
            ? "Apply loads /output-style into the terminal — hit enter to switch the session."
            : `${styles.length} styles · yours, plugin-shipped, and built-in. Click one to open it.`}
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

function StyleCard({ s, onOpen }: { s: LibraryStyle; onOpen: (s: LibraryStyle) => void }) {
  const dot = s.source === "user" ? "text-blue-500" : s.source === "builtin" ? "text-orange-500" : "text-emerald-500";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(s);
        }
      }}
      className="cursor-pointer rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className={`shrink-0 text-[10px] leading-none ${dot}`} aria-hidden>●</span>
          <span className="truncate font-mono text-[13px] text-zinc-200">{s.name}</span>
        </span>
        {s.source === "builtin" && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-zinc-600">built-in</span>
        )}
      </div>

      <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">{s.sourceLabel}</div>

      {s.description && (
        <p className="mt-3 line-clamp-2 text-[11px] leading-snug text-zinc-500">{s.description}</p>
      )}
    </div>
  );
}

function StyleDetailView({ style: s }: { style: LibraryStyle }) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!s.path) {
      setBody(null);
      return;
    }
    let abort = false;
    setLoading(true);
    setBody(null);
    fetch(`/api/output-styles/doc?path=${encodeURIComponent(s.path)}`, { cache: "no-store" })
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
  }, [s.path]);

  return (
    <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-mono text-[11px] text-zinc-400">{s.sourceLabel}</div>
        <button
          type="button"
          onClick={() => prefill(`/output-style ${s.name} `)}
          title={`Switch to ${s.name}`}
          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Apply
        </button>
      </div>

      {s.description && <p className="text-[12px] leading-relaxed text-zinc-300">{s.description}</p>}

      {!s.path ? (
        <p className="border-t border-dashed border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
          Built-in — part of the CLI, no file to show. Apply it from the terminal.
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

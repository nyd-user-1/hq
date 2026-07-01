"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { ago } from "@/lib/ago";
import { useIssues } from "@/app/ui/issues-state";
import type { Issue } from "@/lib/issues";

// The Issues panel — the hq repo's GitHub Issues as a card list in a standalone
// toggle panel (its own portal root #issues-panel-root), mirroring the Changelog
// panel: AppPanel chrome, a live /api/issues fetch. Reads via `gh` (no DB). A
// compact composer files a new issue (POST /api/issues) then refreshes the list.
// Each card links out to the issue on GitHub.
export default function IssuesPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { open, setOpen } = useIssues();
  const active = embedded || open;
  const [items, setItems] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // composer state
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [filing, setFiling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/issues", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setItems(d.issues ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const fileIssue = async () => {
    const t = title.trim();
    if (!t || filing) return;
    setFiling(true);
    setErr("");
    try {
      const r = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, body }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d?.error || "failed to file issue");
      setTitle("");
      setBody("");
      setComposing(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to file issue");
    } finally {
      setFiling(false);
    }
  };

  const content = (
    <>
        {/* header — title + count + new + refresh */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[12px] text-zinc-300">Issues</span>
          <span className="font-mono text-[10px] tabular-nums text-zinc-600">{items.length}</span>
          <button
            onClick={() => setComposing((c) => !c)}
            className="ml-auto shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          >
            {composing ? "Cancel" : "+ New issue"}
          </button>
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

        {/* composer — compact: title input + body textarea + File issue */}
        {composing && (
          <div className="flex shrink-0 flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              autoFocus
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] leading-snug text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <div className="flex items-center justify-end">
              <button
                onClick={fileIssue}
                disabled={!title.trim() || filing}
                className="shrink-0 rounded-md border border-emerald-700/60 bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] text-emerald-300 transition-colors hover:border-emerald-600 hover:bg-emerald-500/20 disabled:opacity-40"
              >
                {filing ? "Filing…" : "File issue"}
              </button>
            </div>
          </div>
        )}

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {/* the list OWNS the scroll (min-h-0 flex-1 overflow-y-auto) so it stays
            within the panel's dashed frame; the header + composer above are
            shrink-0 and stay put. */}
        <ul className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
          {items.map((it) => (
            <li key={it.number} className="rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5">
              <div className="flex items-start gap-2">
                {/* state dot — OPEN emerald, CLOSED zinc */}
                <span
                  className={`mt-1 shrink-0 text-[10px] leading-none ${it.state === "OPEN" ? "text-emerald-500" : "text-zinc-500"}`}
                  title={it.state}
                  aria-hidden
                >
                  ●
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs font-medium text-zinc-200 transition-colors hover:text-blue-300"
                  >
                    <span className="font-mono text-zinc-500">#{it.number}</span> {it.title}
                  </a>
                  {it.labels.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {it.labels.map((l) => (
                        <span
                          key={l.name}
                          className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* footer: state · relative updated time */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-zinc-600">
                    <span>{it.state.toLowerCase()}</span>
                    <span className="text-zinc-700">·</span>
                    <span suppressHydrationWarning>{ago(it.updatedAt)}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
          {!items.length && !loading && (
            <p className="font-mono text-[11px] text-zinc-600">
              {err ? "could not reach gh" : "no issues"}
            </p>
          )}
        </ul>
    </>
  );
  if (embedded) return content;
  return (
    <AppPanel
      rootId="issues-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(400px,40vw)]"
    >
      <Boundary label="issues-panel.tsx">{content}</Boundary>
    </AppPanel>
  );
}

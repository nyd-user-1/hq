"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import Markdown from "@/app/ui/md";
import { useAudit } from "@/app/ui/audit-state";
import { ago } from "@/lib/ago";

// Memory Audit panel — the standalone-portal twin of @panel/(metrics)/audit. The
// standing context tax made visible: instruction files every session loads before
// you type a word, per-project rules, and the memory store (heaviest first, stale
// flagged). Mirrors the route page but lives in its OWN portal root
// (#audit-panel-root) driven by useAudit, so it sits open alongside other panels.
//
// Types are INLINED (the API's JSON shape) on purpose — importing them from the
// node:fs lib/audit would drag fs into the client bundle.
type AuditFile = { label: string; tokens: number; mtime: number; path: string };
type MemoryEntry = {
  name: string;
  description: string;
  tokens: number;
  mtime: number;
  stale: boolean;
  path: string;
};
type Audit = {
  everySession: AuditFile[];
  perProject: AuditFile[];
  memory: MemoryEntry[];
  memoryTotalTokens: number;
  staleCount: number;
};

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export default function AuditPanel() {
  const { open, setOpen } = useAudit();
  const [data, setData] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // drill-down: the opened .md (path + fetched content)
  const [sel, setSel] = useState<{ path: string; label: string } | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/audit", { cache: "no-store" }).then((res) => res.json());
      if (r?.error) throw new Error(r.error);
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // fetch the selected doc's markdown (path-guarded server-side via readAuditDoc)
  useEffect(() => {
    if (!sel) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setDocLoading(true);
    setDoc(null);
    fetch(`/api/audit?open=${encodeURIComponent(sel.path)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => !cancelled && setDoc(d?.content ?? null))
      .catch(() => !cancelled && setDoc(null))
      .finally(() => !cancelled && setDocLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sel]);

  const sessionTax = (data?.everySession ?? []).reduce((s, f) => s + f.tokens, 0);

  // One compact clickable row: label · ~tok · ago — opens the .md in-panel.
  const Row = (f: AuditFile) => (
    <button
      key={f.path}
      onClick={() => setSel({ path: f.path, label: f.label })}
      className="flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-1.5 text-left font-mono text-xs transition-colors hover:bg-zinc-800/30"
    >
      <span className="min-w-0 flex-1 truncate text-zinc-300">{f.label}</span>
      <span className="shrink-0 text-zinc-400">~{fmt(f.tokens)} tok</span>
      <span className="w-14 shrink-0 text-right text-zinc-600">{ago(f.mtime)}</span>
    </button>
  );

  return (
    <AppPanel
      rootId="audit-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="audit-panel.tsx">
        {sel ? (
          // ── opened .md ───────────────────────────────────────────────────
          <>
            <div className="flex shrink-0 items-baseline gap-3">
              <button
                onClick={() => setSel(null)}
                className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
              >
                ← audit
              </button>
              <span className="min-w-0 truncate font-mono text-xs text-zinc-500">{sel.label}</span>
            </div>
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto border-t border-zinc-800 pt-3 text-sm">
              {docLoading ? (
                <p className="font-mono text-xs text-zinc-600">loading…</p>
              ) : doc ? (
                <Markdown text={doc} />
              ) : (
                <p className="font-mono text-xs text-zinc-600">file not found</p>
              )}
            </div>
          </>
        ) : (
          // ── audit list ───────────────────────────────────────────────────
          <>
            <div className="flex shrink-0 items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">memory audit</span>
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

            {err && (
              <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
                {err}
              </p>
            )}

            <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
              {!data && loading && (
                <p className="font-mono text-[11px] text-zinc-600">loading…</p>
              )}

              {data && (
                <>
                  <section className="flex flex-col gap-1">
                    <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      loaded every home session
                    </h2>
                    <p className="text-xs text-zinc-400">
                      every new session starts ~{fmt(sessionTax)} tokens deep before you type a word —
                      trimming these pays back on every session.
                    </p>
                    <div className="flex flex-col">{data.everySession.map(Row)}</div>
                  </section>

                  {data.perProject.length > 0 && (
                    <section className="flex flex-col gap-1">
                      <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                        per-project rules (added when working there)
                      </h2>
                      <div className="flex flex-col">{data.perProject.map(Row)}</div>
                    </section>
                  )}

                  <section className="flex flex-col gap-1">
                    <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      memory store — {data.memory.length} files · ~{fmt(data.memoryTotalTokens)} tok ·{" "}
                      {data.staleCount} stale
                    </h2>
                    <p className="text-xs text-zinc-400">
                      these load on demand, not every session — but each one is a line in the index
                      above. Amber = untouched 30+ days; resolved or stale ones are prune candidates.
                    </p>
                    <div className="flex flex-col">
                      {data.memory.map((m) => (
                        <button
                          key={m.name}
                          onClick={() => setSel({ path: m.path, label: m.name })}
                          className="flex flex-col gap-0.5 border-b border-zinc-800/60 py-1.5 text-left transition-colors hover:bg-zinc-800/30"
                        >
                          <span className="flex items-baseline gap-3 font-mono text-xs">
                            <span className="min-w-0 flex-1 truncate text-zinc-300">{m.name}</span>
                            {m.stale && (
                              <span className="shrink-0 text-[10px] text-amber-400">
                                stale {Math.floor((Date.now() - m.mtime) / 86400000)}d
                              </span>
                            )}
                            <span className="shrink-0 text-zinc-500">~{fmt(m.tokens)} tok</span>
                          </span>
                          {m.description && (
                            <span className="truncate text-[11px] text-zinc-500">{m.description}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </>
        )}
      </Boundary>
    </AppPanel>
  );
}

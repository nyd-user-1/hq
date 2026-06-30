"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useEnvironment } from "@/app/ui/environment-state";

// The Environment panel — a standalone client-state portal (its own
// #environment-panel-root), cloned from the Skills / Permissions panels. ONE
// surface over the safe allowlist of the shell hq was launched with: PATH/SHELL/
// HOME/LANG/TERM/NODE_ENV + the npm_*/CLAUDE_* families, with any credential-ish
// value already masked server-side. A searchable key/value table — read-only.
//
// EnvVar is inlined (not imported from lib/environment) so Turbopack never drags
// node:fs/os into this client bundle — it mirrors the API's JSON shape.
type EnvVar = { key: string; value: string };

export default function EnvironmentPanel() {
  const { open, setOpen } = useEnvironment();
  const [items, setItems] = useState<EnvVar[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/environment", { cache: "no-store" }).then((res) => res.json());
      if (r.error) throw new Error(r.error);
      setItems(r.items ?? []);
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
  const shown = useMemo(
    () =>
      items.filter(
        (v) => !query || v.key.toLowerCase().includes(query) || v.value.toLowerCase().includes(query),
      ),
    [items, query],
  );

  return (
    <AppPanel
      rootId="environment-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="environment-panel.tsx">
        {/* search + refresh */}
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={items.length ? `Search ${items.length} variables…` : "Search environment…"}
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

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {/* key/value table */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
          {shown.length ? (
            shown.map((v) => (
              <div key={v.key} className="rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2">
                <div className="break-all font-mono text-[11px] font-medium text-zinc-200">{v.key}</div>
                <div className="mt-1 break-all font-mono text-[11px] leading-snug text-zinc-500">
                  {v.value || <span className="text-zinc-700">(empty)</span>}
                </div>
              </div>
            ))
          ) : (
            <p className="px-0.5 font-mono text-[11px] text-zinc-600">
              {loading ? "loading…" : query ? `no variables match “${q}”.` : "no environment variables."}
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {items.length} variables · safe allowlist · credential values masked.
        </footer>
      </Boundary>
    </AppPanel>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useMcp } from "@/app/ui/mcp-state";
import type { McpServer } from "@/lib/mcp";

// hq's MCP panel — sibling of the Skills / Commands panels. A read-only view of
// the Model Context Protocol servers configured for Claude Code on this machine,
// read off disk from ~/.claude.json (global + per-project) and this repo's
// .mcp.json. Filter by scope; click a server to copy its launch command/URL.
// (Remote claude.ai connectors are managed server-side and aren't on disk.)

const TRANSPORT_TINT: Record<string, string> = {
  stdio: "border-sky-500/40 text-sky-300",
  http: "border-emerald-500/40 text-emerald-300",
  sse: "border-violet-500/40 text-violet-300",
};

export default function McpPanel() {
  const { open, setOpen } = useMcp();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/mcp", { cache: "no-store" }).then((res) => res.json());
      setServers(r?.servers ?? []);
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
    (s: McpServer) =>
      !query ||
      s.name.toLowerCase().includes(query) ||
      s.command.toLowerCase().includes(query) ||
      s.scopeLabel.toLowerCase().includes(query),
    [query],
  );

  // scope chips, by scope key, most-populous first (label is the display).
  const scopes = useMemo(() => {
    const counts: Record<string, { label: string; n: number }> = {};
    for (const s of servers) {
      counts[s.scope] ??= { label: s.scopeLabel, n: 0 };
      counts[s.scope].n++;
    }
    return Object.entries(counts).sort((a, b) => b[1].n - a[1].n);
  }, [servers]);

  const shown = servers
    .filter((s) => (scope === "all" || s.scope === scope) && matchesQuery(s))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <AppPanel
      rootId="mcp-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="mcp-panel.tsx">
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={servers.length ? `Search ${servers.length} servers…` : "Search MCP servers…"}
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

        {servers.length > 0 && (
          <div className="scrollbar-none mt-1 flex shrink-0 gap-1.5 overflow-x-auto overscroll-x-contain">
            <ScopeChip label="all" count={servers.length} active={scope === "all"} onClick={() => setScope("all")} />
            {scopes.map(([key, { label, n }]) => (
              <ScopeChip key={key} label={label} count={n} active={scope === key} onClick={() => setScope(key)} />
            ))}
          </div>
        )}

        <div className="scrollbar-none -mr-2 mt-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
          {shown.length ? (
            shown.map((s) => <ServerCard key={s.id} s={s} />)
          ) : (
            <p className="px-0.5 font-mono text-[11px] text-zinc-600">
              {loading ? "loading…" : query ? `no servers match “${q}”.` : "No MCP servers configured on disk."}
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {servers.length} servers · global, per-project, and .mcp.json. Read from disk.
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function ScopeChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
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
      <span className="max-w-[120px] truncate">{label}</span>
      <span className={`tabular-nums ${active ? "text-zinc-500" : "text-zinc-600"}`}>{count}</span>
    </button>
  );
}

function ServerCard({ s }: { s: McpServer }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };
  const tint = TRANSPORT_TINT[s.transport] ?? "border-zinc-700 text-zinc-400";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          copy();
        }
      }}
      title="Click to copy the command / URL"
      className="cursor-pointer rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-mono text-[13px] text-zinc-200">{s.name}</span>
        </span>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tint}`}>
          {s.transport}
        </span>
      </div>

      <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">{copied ? "copied" : s.scopeLabel}</div>

      {s.command && (
        <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-zinc-500">{s.command}</p>
      )}

      {s.envKeys.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {s.envKeys.map((k) => (
            <span key={k} className="rounded border border-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-600">
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

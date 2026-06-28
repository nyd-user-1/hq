"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import SearchField from "@/app/ui/search-field";
import TerminalNavMenu from "@/app/ui/terminal-nav-menu";

// The full-width PROJECTS browser — a 1:1 content swap of the Files view (same
// shell: focus-mode header with the ⋮ kebab, a chip band, a filter, a windowed
// table). The chips are PROJECTS (click to scope); the table is SESSIONS (every
// transcript, enriched). Lives in the center column as an overlay (project-
// overlay.tsx) so the terminal stays mounted underneath. Click a row to open it.

type Sess = {
  id: string;
  project: string;
  title: string;
  customTitle: string;
  snippet: string;
  contextTokens: number;
  surface: "hq" | "cc";
  lastActive: number;
  live: boolean;
  active: boolean;
};

const CLIFF = 200_000;
function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
const fmtCtx = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export default function ProjectView() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [proj, setProj] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(true); // start in focus mode, like a session

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/sessions/all", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (alive) {
            setSessions(Array.isArray(d?.sessions) ? d.sessions : []);
            setLoading(false);
          }
        })
        .catch(() => alive && setLoading(false));
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // chips = projects by session count, most-active first
  const projects = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(s.project, (m.get(s.project) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sessions
      .filter((s) => (!proj || s.project === proj) && (!t || `${s.id} ${s.project} ${s.customTitle} ${s.title} ${s.snippet}`.toLowerCase().includes(t)))
      .sort((a, b) => b.lastActive - a.lastActive);
  }, [sessions, q, proj]);

  const close = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("center");
    router.push(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };
  const open = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", id);
    sp.delete("center");
    router.push(`${pathname}?${sp}`, { scroll: false });
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-3 font-mono ${focusMode ? "mx-auto w-full max-w-3xl" : ""}`}>
      {/* header — matches the session header: ● projects · ⋮ kebab, close + focus right */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/60 pb-3">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500/80" />
          <span className="font-mono text-zinc-300">projects</span>
        </span>
        <TerminalNavMenu project="" sessionId={null} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button onClick={close} aria-label="Close projects" title="Close projects" className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          <button type="button" onClick={() => setFocusMode((f) => !f)} aria-label={focusMode ? "Wide screen" : "Focus mode"} title={focusMode ? "Wide screen" : "Focus mode"} className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
            {focusMode ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" x2="14" y1="3" y2="10" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" x2="21" y1="10" y2="3" />
                <line x1="3" x2="10" y1="21" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* project chips — the parallel to Files' recent-file band; click to scope */}
      {!loading && projects.length > 0 && (
        <div className="scrollbar-none mt-3 grid grid-flow-col grid-rows-2 auto-cols-[9rem] gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setProj(null)}
            className={`flex h-9 items-center justify-center rounded-md border px-2 text-[11px] transition-colors ${proj === null ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300"}`}
          >
            all · {sessions.length}
          </button>
          {projects.map(([p, n]) => (
            <button
              key={p}
              type="button"
              onClick={() => setProj(proj === p ? null : p)}
              title={`${n} sessions in ${p}`}
              className={`flex h-9 items-center rounded-md border px-2 transition-colors ${proj === p ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300"}`}
            >
              <span className="w-full truncate text-center text-[11px]">{p} · {n}</span>
            </button>
          ))}
        </div>
      )}

      {/* filter */}
      <SearchField value={q} onChange={setQ} placeholder="Filter sessions by id, project, or text…" className="mt-3 max-w-md" />

      {/* table — sessions */}
      {loading ? (
        <p className="text-sm text-zinc-600">loading sessions…</p>
      ) : (
        <div className="scrollbar-none min-h-0 flex-1 overflow-auto rounded-md border border-zinc-800/70">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10 bg-zinc-950">
              <tr className="text-zinc-600">
                <th className="px-3 py-2 text-left font-normal uppercase tracking-wider">Session</th>
                <th className="px-3 py-2 text-left font-normal uppercase tracking-wider">Description</th>
                <th className="px-3 py-2 text-left font-normal uppercase tracking-wider">Project</th>
                <th className="px-3 py-2 text-right font-normal uppercase tracking-wider">Context</th>
                <th className="px-3 py-2 text-left font-normal uppercase tracking-wider">Surface</th>
                <th className="px-3 py-2 text-right font-normal uppercase tracking-wider">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} onClick={() => open(s.id)} className="cursor-pointer border-t border-zinc-800/60 transition-colors hover:bg-zinc-900">
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className={`size-1.5 shrink-0 rounded-full ${s.live ? "bg-green-400 animate-pulse" : s.active ? "bg-green-400" : "bg-zinc-600"}`} />
                      <span className="text-green-400">{s.customTitle || s.id.slice(0, 8)}</span>
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2 text-zinc-400">{s.snippet || s.title}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-300">{s.project}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right ${s.contextTokens > CLIFF ? "text-amber-400" : "text-zinc-400"}`}>{fmtCtx(s.contextTokens)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-500">{s.surface}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-500">{ago(s.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="px-3 py-4 text-[11px] text-zinc-600">no sessions</p>}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// THE FLEET — HQ's mission-control roster of every live agent the REPL daemon
// holds (many top-level `claude` sessions kept warm at once, surviving UI
// restarts). Polls /api/terminal/repl/list (~1.5s; non-spawning, so an empty
// machine just shows the empty state). Each row: status · project/title · branch ·
// last activity. Click a row to switch Terminal 1 (?session) to that agent — the
// "see-all / steer-all" cockpit; the ■ releases the process. This is the INTER-
// session view (many top-level agents); the Orchestration panel is the intra-
// session structure (subagent fan-out, workflow, /clear chains).
type FleetRow = {
  key: string;
  sessionId: string | null;
  mode: "control" | "observe"; // hq DRIVES it (steerable) vs only OBSERVES a live TUI
  project: string;
  title: string;
  branch: string;
  cwd: string;
  running: boolean;
  busy: boolean;
  pending: number;
  watched: boolean;
  startedAt: number;
  lastActivity: number;
};

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// status → dot + label, in priority order: a BLOCKED agent (waiting on a
// permission answer) needs you before a merely-working one; an exited one is a
// dim tombstone until the daemon's reaper drops it.
function statusOf(a: FleetRow): { dot: string; label: string; tone: string; pulse: boolean } {
  if (!a.running) return { dot: "bg-zinc-600", label: "exited", tone: "text-zinc-500", pulse: false };
  if (a.pending > 0) return { dot: "bg-amber-500", label: "needs you", tone: "text-amber-400", pulse: true };
  if (a.busy) return { dot: "bg-emerald-500", label: "working", tone: "text-emerald-400", pulse: true };
  // not mid-stream: a control agent sits "idle"; a live terminal we only observe is "live".
  return { dot: "bg-emerald-500", label: a.mode === "observe" ? "live" : "idle", tone: "text-zinc-500", pulse: false };
}

// The Control/Observe affordance — does hq drive this agent, or only watch it?
function ModeChip({ mode }: { mode: FleetRow["mode"] }) {
  return (
    <span
      title={mode === "control" ? "hq drives this — send turns, stop" : "a live terminal hq mirrors but can't steer — click, then take the wheel to control"}
      className={`shrink-0 rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-wide ${
        mode === "control" ? "bg-emerald-500/10 text-emerald-400" : "bg-sky-500/10 text-sky-400"
      }`}
    >
      {mode}
    </span>
  );
}

export default function FleetView() {
  const [agents, setAgents] = useState<FleetRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await fetch("/api/terminal/repl/list", { cache: "no-store" }).then((r) => r.json());
        if (alive) setAgents(Array.isArray(d?.agents) ? d.agents : []);
      } catch {
        /* keep the last list on a blip */
      } finally {
        if (alive) {
          setLoaded(true);
          timer = setTimeout(load, 1500);
        }
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Switch Terminal 1 to this agent + reveal the terminal (drop ?center); keep
  // ?pair (Terminal 2) and the open panel untouched.
  const switchHref = (sessionId: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", sessionId);
    sp.delete("center");
    return `${pathname}${sp.toString() ? `?${sp}` : ""}`;
  };

  const stop = async (e: React.MouseEvent, session: string) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/terminal/repl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop", session }),
    }).catch(() => {});
  };

  const liveCount = agents.filter((a) => a.running).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 font-mono">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/60 pb-2 text-[11px]">
        <span className="text-zinc-200">Fleet</span>
        {agents.length > 0 && (
          <span className="text-zinc-600">
            · {liveCount} live / {agents.length}
          </span>
        )}
        <span className="ml-auto text-zinc-600">every live session — control (hq-driven) + observe (live terminals) · click to switch</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[11px]">
            <span className="size-2 rounded-full bg-zinc-700" />
            {loaded ? (
              <>
                <p className="text-zinc-300">No live sessions</p>
                <p className="text-zinc-600">
                  Open a terminal or drive a session (New Session) and it shows up here — observe or control.
                </p>
              </>
            ) : (
              <p className="text-zinc-500">loading fleet…</p>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {agents.map((a) => {
              const s = statusOf(a);
              const id = a.sessionId || a.key;
              return (
                <li key={a.key}>
                  <Link
                    href={switchHref(id)}
                    scroll={false}
                    title={a.cwd}
                    className={`group flex items-center gap-3 rounded-md border border-zinc-800/70 px-3 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900 ${
                      a.running ? "" : "opacity-50"
                    }`}
                  >
                    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
                      {s.pulse && (
                        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${s.dot} opacity-60`} />
                      )}
                      <span className={`relative inline-flex size-2.5 rounded-full ${s.dot}`} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="shrink-0 font-medium text-zinc-200">{a.project}</span>
                        <span className="truncate text-zinc-500">{a.title}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
                        <span className={s.tone}>{s.label}</span>
                        {a.branch && <span className="truncate">⎇ {a.branch}</span>}
                        <span>· {ago(a.lastActivity)}</span>
                        {a.watched && <span className="text-zinc-500">· watching</span>}
                      </div>
                    </div>

                    <ModeChip mode={a.mode} />

                    {/* stop only makes sense for a process hq owns */}
                    {a.running && a.mode === "control" && (
                      <button
                        type="button"
                        onClick={(e) => stop(e, id)}
                        title="Stop this agent (release the process)"
                        className="shrink-0 rounded p-1 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-zinc-800 hover:text-red-300"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <rect x="6" y="6" width="12" height="12" rx="1.5" />
                        </svg>
                      </button>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

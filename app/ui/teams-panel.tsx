"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { withPins } from "@/app/ui/keep-pins";
import { ago } from "@/lib/ago";
import { useTeams } from "@/app/ui/teams-state";
import { useTasks } from "@/app/ui/tasks-state";

// hq's Teams panel — a standalone client-state portal, cloned from
// skills-panel.tsx. ONE surface over the active agent teams spawned from your
// Claude Code sessions (GET /api/teams). Each team card lists its roster (lead +
// teammates, color-dotted) and offers two ways into the terminal: "Drive lead"
// pins the lead as the main terminal, "Open on wall" pins it AND opens the team
// wall (?wall=@team:<id>). A Tasks row drills into the team's task list (the
// separate Tasks panel, keyed off localStorage "hq-tasks-team").

type TeamMember = {
  name: string;
  agentId: string;
  agentType: string;
  color: string;
  model: string;
  isLead: boolean;
  backendType: string;
  cwd: string;
  prompt: string;
};
type Team = {
  id: string;
  name: string;
  leadSessionId: string;
  createdAt: number;
  members: TeamMember[];
};

// CC team `color` string → a text-<color>-400 dot. Unknown/blank → muted zinc.
const COLOR_MAP: Record<string, string> = {
  blue: "text-blue-400",
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
};
function memberColor(c: string): string {
  return COLOR_MAP[(c ?? "").toLowerCase()] ?? "text-zinc-400";
}

export default function TeamsPanel() {
  const { open, setOpen } = useTeams();
  const { setOpen: setTasksOpen } = useTasks();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnCwd, setSpawnCwd] = useState("/Users/brendanstanton/Code/hq");
  const [spawnPrompt, setSpawnPrompt] = useState("");
  const [spawning, setSpawning] = useState(false);
  const [spawnMsg, setSpawnMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/teams", { cache: "no-store" }).then((res) => res.json());
      setTeams(r?.teams ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    const iv = setInterval(load, 5000); // auto-surface a freshly spawned team
    return () => clearInterval(iv);
  }, [open, load]);

  // Spawn a brand-new team FROM hq: a managed tmux split-pane session.
  const spawn = async () => {
    const cwd = spawnCwd.trim();
    const prompt = spawnPrompt.trim();
    if (!cwd || !prompt || spawning) return;
    setSpawning(true);
    setSpawnMsg("");
    try {
      const r = await fetch("/api/teams/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, prompt }),
      }).then((res) => res.json());
      if (r?.ok) {
        setSpawnMsg("spawning… the team appears here in ~30s");
        setSpawnPrompt("");
        setSpawnOpen(false);
      } else {
        setSpawnMsg(r?.error ?? "spawn failed");
      }
    } catch (e) {
      setSpawnMsg(e instanceof Error ? e.message : "spawn failed");
    } finally {
      setSpawning(false);
    }
  };

  // Drive lead — pin the lead session as the main terminal (Terminal 1), keeping
  // any existing wall pin. withPins keeps the URL down to ?session/?wall.
  const driveLead = (t: Team) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", t.leadSessionId);
    router.push(withPins(pathname, `?${sp.toString()}`), { scroll: false });
    setOpen(false);
  };

  // Open on wall — add the lead as a live wall pane BESIDE the current terminal
  // (terminal separation), rather than replacing Terminal 1. Teammates are
  // in-process subagents with no top-level session, so they aren't wall panes
  // yet — watch them in the roster above; the lead is the drivable thread.
  const openOnWall = (t: Team) => {
    const sp = new URLSearchParams(params.toString());
    const toks = (sp.get("wall") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (sp.get("session") !== t.leadSessionId && !toks.includes(t.leadSessionId))
      toks.push(t.leadSessionId);
    if (toks.length) sp.set("wall", toks.join(","));
    router.push(withPins(pathname, `?${sp.toString()}`), { scroll: false });
    setOpen(false);
  };

  // Open the Tasks panel for this team — stash the id so the Tasks panel reads it.
  const openTasks = (t: Team) => {
    try {
      localStorage.setItem("hq-tasks-team", t.id);
    } catch {
      /* ignore */
    }
    setTasksOpen(true);
  };

  return (
    <AppPanel
      rootId="teams-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="teams-panel.tsx">
        {/* header — title + refresh */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[12px] text-zinc-300">Teams</span>
          <span className="font-mono text-[10px] tabular-nums text-zinc-600">{teams.length}</span>
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="ml-auto flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
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

        {/* Spawn a team FROM hq — a managed tmux split-pane session (real,
            drivable agents). */}
        <div className="shrink-0">
          {spawnOpen ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/30 p-2">
              <input
                value={spawnCwd}
                onChange={(e) => setSpawnCwd(e.target.value)}
                placeholder="working dir"
                className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <textarea
                value={spawnPrompt}
                onChange={(e) => setSpawnPrompt(e.target.value)}
                rows={3}
                placeholder="the team's task — e.g. “Spawn 3 teammates to review PR #142: security, performance, tests.”"
                className="scrollbar-none resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSpawnOpen(false)}
                  className="rounded-md border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  cancel
                </button>
                <button
                  type="button"
                  onClick={spawn}
                  disabled={spawning}
                  className="rounded-md border border-emerald-600/50 bg-emerald-600/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-600/25 disabled:opacity-50"
                >
                  {spawning ? "spawning…" : "Spawn team"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSpawnOpen(true)}
              className="w-full rounded-md border border-dashed border-zinc-700 px-2 py-1.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
            >
              + Spawn team
            </button>
          )}
          {spawnMsg && <p className="mt-1 font-mono text-[10px] text-zinc-500">{spawnMsg}</p>}
        </div>

        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
          {teams.length ? (
            teams.map((t) => (
              <TeamCard key={t.id} team={t} onDrive={driveLead} onWall={openOnWall} onTasks={openTasks} />
            ))
          ) : (
            <p className="px-0.5 font-mono text-[11px] leading-relaxed text-zinc-600">
              {loading ? "loading…" : "No active agent teams. Spawn a team from a Claude Code session."}
            </p>
          )}
        </div>

        {/* footer */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {teams.length
            ? "Drive lead pins the lead terminal · Open on wall opens the team wall."
            : "Teams spawn when a session orchestrates a multi-agent crew."}
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function TeamCard({
  team,
  onDrive,
  onWall,
  onTasks,
}: {
  team: Team;
  onDrive: (t: Team) => void;
  onWall: (t: Team) => void;
  onTasks: (t: Team) => void;
}) {
  const members = team.members ?? [];
  return (
    <div className="rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5">
      {/* header — name · member count · relative createdAt */}
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-200">{team.name}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
          {members.length} {members.length === 1 ? "agent" : "agents"}
        </span>
      </div>
      {team.createdAt ? (
        <div className="mt-0.5 font-mono text-[10px] text-zinc-600">{ago(team.createdAt)}</div>
      ) : null}

      {/* roster — one row per member */}
      <div className="mt-3 flex flex-col gap-2">
        {members.map((m) => (
          <div key={m.agentId || m.name} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className={`shrink-0 text-[10px] leading-none ${memberColor(m.color)}`} aria-hidden>●</span>
              <span className="truncate font-mono text-[12px] text-zinc-200">{m.name}</span>
              {m.agentType && (
                <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wide text-zinc-400">
                  {m.agentType}
                </span>
              )}
              {m.isLead && (
                <span className="shrink-0 rounded bg-blue-500/15 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wide text-blue-300">
                  lead
                </span>
              )}
            </div>
            {!m.isLead && m.prompt && (
              <p className="truncate pl-3 font-mono text-[10px] text-zinc-600">{m.prompt}</p>
            )}
          </div>
        ))}
      </div>

      {/* actions */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onDrive(team)}
          title="Pin the lead session as the main terminal"
          className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Drive lead
        </button>
        <button
          type="button"
          onClick={() => onWall(team)}
          title="Pin the lead and open the team wall"
          className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Open on wall
        </button>
        <button
          type="button"
          onClick={() => onTasks(team)}
          title="Open this team's tasks"
          className="ml-auto shrink-0 font-mono text-[10px] text-blue-400 transition-colors hover:text-blue-300"
        >
          Tasks →
        </button>
      </div>
    </div>
  );
}

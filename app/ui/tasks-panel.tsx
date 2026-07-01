"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useTasks } from "@/app/ui/tasks-state";

// Standalone Tasks panel — the skills/projects push-in standard, a master→detail
// drilldown (cloned from projects-panel.tsx). The active team is read from
// localStorage "hq-tasks-team" (stashed by the Teams panel), falling back to the
// newest team via GET /api/teams. The task list comes from GET /api/tasks?team=…;
// clicking a task drills into its detail (status · dependencies · assignedTo).

// Matches lib/tasks.ts Task (the real ~/.claude/tasks/<id>/<n>.json shape):
// `subject` is the title; dependencies are a blocks/blockedBy id graph; there is
// no assignee on disk.
type Task = {
  id: string;
  subject: string;
  description?: string;
  status: "pending" | "in_progress" | "completed";
  blocks?: string[];
  blockedBy?: string[];
};
type Team = {
  id: string;
  name: string;
  createdAt: number;
  leadSessionId?: string;
  leadTranscriptId?: string;
};

// status → dot color; in_progress pulses.
function statusDot(status?: string): string {
  if (status === "in_progress") return "text-orange-500 animate-pulse";
  if (status === "completed") return "text-emerald-500";
  return "text-zinc-500"; // pending / unknown
}
function statusLabel(status?: string): string {
  return (status ?? "pending").replace(/_/g, " ");
}

export default function TasksPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { open, setOpen } = useTasks();
  // Embedded = hosted inside the Console container (console-panel.tsx), which owns
  // the AppPanel + Boundary and swaps panels in place. Standalone otherwise.
  const active = embedded || open;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [teamName, setTeamName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let teamId = "";
      try {
        teamId = localStorage.getItem("hq-tasks-team") ?? "";
      } catch {
        /* no storage */
      }
      // fallback: the team on the OPEN wall (its lead is ?lead/?session), else the
      // newest. Reads window.location once on open — no useSearchParams, no Suspense.
      if (!teamId) {
        const tr = await fetch("/api/teams", { cache: "no-store" }).then((r) => r.json());
        const arr: Team[] = tr?.teams ?? [];
        let lead = "";
        try {
          const p = new URLSearchParams(window.location.search);
          lead = p.get("lead") || p.get("session") || "";
        } catch {
          /* no window */
        }
        const onWall = lead
          ? arr.find((t) => t.leadTranscriptId === lead || t.leadSessionId === lead || t.id === lead)
          : undefined;
        const newest = [...arr].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
        teamId = (onWall ?? newest)?.id ?? "";
      }
      // The owning team, shown at the top so it's unmistakable whose tasks these
      // are: "Team c4921e42" from "session-c4921e42".
      setTeamName(teamId ? `Team ${teamId.replace(/^session-/, "")}` : "");
      if (!teamId) {
        setTasks([]);
        return;
      }
      const r = await fetch(`/api/tasks?team=${encodeURIComponent(teamId)}`, { cache: "no-store" }).then((res) =>
        res.json(),
      );
      setTasks(r?.tasks ?? []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const sel = selected ? (tasks ?? []).find((t) => t.id === selected) ?? null : null;

  const content = (
    <>
      {sel ? (
        <TaskDetail task={sel} onBack={() => setSelected(null)} />
      ) : tasks ? (
        <TaskList tasks={tasks} teamName={teamName} onSelect={setSelected} />
      ) : (
        <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "no tasks"}</p>
      )}
    </>
  );
  if (embedded) return content;
  return (
    <AppPanel
      rootId="tasks-panel-root"
      open={open}
      onClose={() => {
        setOpen(false);
        setSelected(null);
      }}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="tasks-panel.tsx">{content}</Boundary>
    </AppPanel>
  );
}

function TaskList({
  tasks,
  teamName,
  onSelect,
}: {
  tasks: Task[];
  teamName: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {/* header — the OWNING TEAM is the hero, so it's clear whose tasks these are */}
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-200">
          {teamName || "Tasks"}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
      <div className="font-mono text-[10px] text-zinc-600">shared task list</div>

      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600">no tasks for this team</p>
      ) : (
        <div className="scrollbar-none mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto">
          {tasks.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="flex w-full items-baseline gap-2.5 border-b border-zinc-800/60 py-3 text-left transition-colors hover:bg-zinc-800/30"
            >
              <span className={`shrink-0 text-[10px] leading-none ${statusDot(t.status)}`} aria-hidden>
                ●
              </span>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">#{t.id}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{t.subject}</span>
              {(t.blockedBy?.length ?? 0) > 0 && (
                <span className="shrink-0 font-mono text-[11px] text-zinc-600" title="blocked by upstream tasks">
                  blocked
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskDetail({ task, onBack }: { task: Task; onBack: () => void }) {
  const deps = task.blockedBy ?? [];
  const blocks = task.blocks ?? [];
  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <button
        type="button"
        onClick={onBack}
        className="shrink-0 self-start font-mono text-xs text-blue-400 transition-colors hover:text-blue-300"
      >
        ← Tasks
      </button>

      <h2 className="text-[14px] font-medium leading-snug text-zinc-100">{task.subject}</h2>
      {task.description && task.description !== task.subject && (
        <p className="font-mono text-[11px] leading-relaxed text-zinc-400">{task.description}</p>
      )}

      <dl className="flex flex-col gap-2 font-mono text-[11px]">
        <div className="flex items-center gap-2">
          <dt className="w-20 shrink-0 text-zinc-600">status</dt>
          <dd className="flex items-center gap-1.5 text-zinc-300">
            <span className={`text-[10px] leading-none ${statusDot(task.status)}`} aria-hidden>●</span>
            {statusLabel(task.status)}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="w-20 shrink-0 text-zinc-600">depends on</dt>
          <dd className="min-w-0 flex-1 text-zinc-300">
            {deps.length ? (
              <span className="flex flex-wrap gap-1">
                {deps.map((d) => (
                  <span key={d} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    #{d}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-zinc-600">nothing</span>
            )}
          </dd>
        </div>
        {blocks.length > 0 && (
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-zinc-600">blocks</dt>
            <dd className="min-w-0 flex-1 text-zinc-300">
              <span className="flex flex-wrap gap-1">
                {blocks.map((d) => (
                  <span key={d} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    #{d}
                  </span>
                ))}
              </span>
            </dd>
          </div>
        )}
        <div className="flex items-center gap-2">
          <dt className="w-20 shrink-0 text-zinc-600">id</dt>
          <dd className="min-w-0 truncate text-zinc-500">#{task.id}</dd>
        </div>
      </dl>
    </div>
  );
}

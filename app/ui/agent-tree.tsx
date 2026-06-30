"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ago } from "@/lib/ago";
import { withPins } from "@/app/ui/keep-pins";
import type { SubagentNode } from "@/lib/subagents";
import type { BackgroundAgent } from "@/lib/jobs";
import type { Team } from "@/lib/teams";

// AGENT TREE — the single-pane hierarchy: each interactive session that spawned
// subagents, rendered as an indented tree (agentType · description · live dot ·
// age), plus a Background-agents section and (when present) Agent teams.
//
// Clicking a session row OR a subagent row pins the PARENT session in the
// terminal (?session=<id>) — subagents aren't independently resumable, so a
// subagent deep-links to its parent. Every href carries the existing pins via
// withPins so opening this view never snaps the terminal to a new session.

export type SessionBranch = {
  id: string;
  project: string;
  title: string;
  lastActive: number;
  active: boolean;
  subagents: SubagentNode[];
};

const sizeLabel = (n: SubagentNode) =>
  n.bytes >= 1024 * 1024
    ? `${(n.bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(n.bytes / 1024))}KB`;

function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`text-[10px] leading-none ${active ? "text-green-500" : "text-zinc-600"}`}
      aria-hidden
    >
      ●
    </span>
  );
}

export default function AgentTree({
  sessions,
  jobs,
  teams,
}: {
  sessions: SessionBranch[];
  jobs: BackgroundAgent[];
  teams: Team[];
}) {
  const params = useSearchParams();
  const search = `?${params.toString()}`;
  const current = params.get("session");

  // Pin a session (the subagent's parent) in the terminal, keeping pair + this
  // panel's own params intact.
  const pinHref = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", id);
    return `/tree?${sp.toString()}`;
  };

  return (
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-1">
      {/* SESSIONS → subagent tree */}
      <section className="flex flex-col gap-1">
        <h3 className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
          Sessions with subagents
        </h3>
        {sessions.length === 0 ? (
          <p className="text-xs text-zinc-600">
            no session has spawned subagents — run an Agent/Explore task and it lands here
          </p>
        ) : (
          sessions.map((s) => {
            const selected = current === s.id;
            return (
              <div key={s.id} className="flex flex-col">
                {/* parent session row */}
                <Link
                  href={pinHref(s.id)}
                  scroll={false}
                  className={`flex items-baseline gap-2 rounded-sm py-1.5 transition-colors hover:bg-zinc-800/30 ${
                    selected ? "bg-green-500/[0.06]" : ""
                  }`}
                >
                  <Dot active={s.active} />
                  <span className="font-mono text-xs text-zinc-200">{s.id.slice(0, 8)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                    {s.project} · {s.title}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                    {selected && <span className="text-green-400">in terminal · </span>}
                    {s.subagents.length} agent{s.subagents.length === 1 ? "" : "s"} · {ago(s.lastActive)}
                  </span>
                </Link>

                {/* nested subagent rows — indented under the session, with a tree gutter */}
                <div className="ml-[7px] flex flex-col border-l border-zinc-800/70 pl-3">
                  {s.subagents.map((a) => (
                    <Link
                      key={a.agentId}
                      href={pinHref(s.id)}
                      scroll={false}
                      title={`${a.agentType} · ${a.description}\n${a.lines} lines · ${sizeLabel(a)} · started ${ago(a.startedAt)}`}
                      className="flex items-baseline gap-2 rounded-sm py-1 text-left transition-colors hover:bg-zinc-800/30"
                    >
                      <Dot active={a.active} />
                      <span className="shrink-0 rounded-sm bg-zinc-800/70 px-1.5 py-px font-mono text-[10px] text-zinc-300">
                        {a.agentType}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                        {a.description || <span className="text-zinc-600">no description</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                        {a.lines} ln · {sizeLabel(a)} · {ago(a.lastActive)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* BACKGROUND / DISPATCHED agents */}
      {jobs.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
            Background agents
          </h3>
          {jobs.map((j) => {
            const running = j.state === "running";
            const done = j.state === "done";
            const stateColor = running
              ? "text-green-400"
              : done
                ? "text-zinc-500"
                : "text-amber-400"; // blocked / waiting on input
            // A background agent has its own sessionId on disk → pin it too.
            const href = j.sessionId
              ? pinHref(j.sessionId)
              : withPins("/tree", search);
            return (
              <Link
                key={j.id}
                href={href}
                scroll={false}
                title={j.detail || j.intent}
                className="flex items-baseline gap-2 rounded-sm py-1.5 transition-colors hover:bg-zinc-800/30"
              >
                <span className={`shrink-0 font-mono text-[10px] ${stateColor}`}>
                  {j.state}
                </span>
                <span className="font-mono text-xs text-zinc-200">{j.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                  {j.detail || j.intent}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                  {j.model ? `${j.model} · ` : ""}
                  {j.updatedAt ? ago(j.updatedAt) : ""}
                </span>
              </Link>
            );
          })}
        </section>
      )}

      {/* AGENT TEAMS — only when the experimental flag has produced any */}
      {teams.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
            Agent teams
          </h3>
          {teams.map((t) => (
            <div key={t.id} className="flex flex-col">
              <div className="flex items-baseline gap-2 py-1.5">
                <span className="font-mono text-xs text-zinc-200">{t.name}</span>
                <span className="font-mono text-[10px] text-zinc-600">
                  {t.members.length} member{t.members.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="ml-[7px] flex flex-col border-l border-zinc-800/70 pl-3">
                {t.members.map((m, i) => (
                  <Link
                    key={i}
                    // Only the lead is a top-level session (pinnable); teammates are
                    // in-process subagents with no session id of their own.
                    href={m.isLead ? pinHref(t.leadSessionId) : withPins("/tree", search)}
                    scroll={false}
                    className="flex items-baseline gap-2 rounded-sm py-1 transition-colors hover:bg-zinc-800/30"
                  >
                    <span className="shrink-0 rounded-sm bg-zinc-800/70 px-1.5 py-px font-mono text-[10px] text-zinc-300">
                      {m.agentType || "agent"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                      {m.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

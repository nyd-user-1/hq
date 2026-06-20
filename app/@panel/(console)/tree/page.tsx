import Boundary from "@/app/ui/boundary";
import AgentTree, { type SessionBranch } from "@/app/ui/agent-tree";
import { getRecentSessions } from "@/lib/sessions";
import { subagentsFor, subagentCounts } from "@/lib/subagents";
import { backgroundAgents } from "@/lib/jobs";
import { teams } from "@/lib/teams";

export const dynamic = "force-dynamic";

// TREE panel — the single-pane agent hierarchy. Each interactive session that
// spawned subagents (Agent/Explore/… tool runs) becomes a branch with its
// nested children; below it, the headless background/dispatched agents
// (~/.claude/jobs) and any experimental agent teams (~/.claude/teams, usually
// absent). All pure node:fs via lib/subagents · lib/jobs · lib/teams; no live
// process is touched. Cloud routines are deliberately NOT here — they have no
// local manifest and live in the Routines panel.

export default async function TreePanel() {
  // Cheap badge map first → only deep-read subagents for sessions that have any.
  const counts = subagentCounts();
  const recents = getRecentSessions(60);

  const sessions: SessionBranch[] = recents
    .filter((s) => counts.has(s.id))
    .map((s) => ({
      id: s.id,
      project: s.project,
      title: s.customTitle || s.title,
      lastActive: s.lastActive,
      active: s.active,
      subagents: subagentsFor(s.id),
    }))
    // a session can be in counts but have its dir vanish between calls — drop empties
    .filter((s) => s.subagents.length > 0);

  const jobs = backgroundAgents();
  const allTeams = teams();
  const totalSub = sessions.reduce((n, s) => n + s.subagents.length, 0);

  return (
    <Boundary topOnly bleedX label="@panel/(console)/tree/page.tsx">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-zinc-300">tree</span>
        <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
          {totalSub} subagent{totalSub === 1 ? "" : "s"}
          {jobs.length > 0 ? ` · ${jobs.length} background` : ""}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
          read-only · on-disk hierarchy
        </span>
      </div>

      <AgentTree sessions={sessions} jobs={jobs} teams={allTeams} />

      <p className="text-xs text-zinc-600">
        nested subagents + background/dispatched agents Claude Code wrote to disk · click a row to pin its parent session · subagents aren&apos;t separately resumable
      </p>
    </Boundary>
  );
}

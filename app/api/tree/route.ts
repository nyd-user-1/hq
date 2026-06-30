import { getRecentSessions } from "@/lib/sessions";
import { subagentsFor, subagentCounts } from "@/lib/subagents";
import { backgroundAgents } from "@/lib/jobs";
import { teams } from "@/lib/teams";
import type { SessionBranch } from "@/app/ui/agent-tree";

// TREE — the single-pane agent hierarchy as JSON for the standalone Tree panel.
// Pure node:fs via lib/subagents · lib/jobs · lib/teams; never cache (the live
// "working" dots come from transcript mtime). Mirrors the on-disk derivation the
// old @panel/(console)/tree route page did server-side. (`SessionBranch` is a
// type-only import — erased at compile, so no client code crosses into the route.)
export const dynamic = "force-dynamic";

// GET — { sessions, jobs, teams }: each interactive session that spawned
// subagents (with its nested children), the headless background/dispatched
// agents, and any experimental agent teams.
export async function GET() {
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

  return Response.json({ sessions, jobs: backgroundAgents(), teams: teams() });
}

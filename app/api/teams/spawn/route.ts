import { spawnTeam } from "@/lib/team-tmux";

export const dynamic = "force-dynamic";

// POST { cwd, prompt } → spawn a brand-new agent team FROM hq: a managed tmux
// session running an interactive, split-pane, team-aware claude, handed the task.
// Returns { ok, teamId, tmuxSession, leadSessionId }; the team appears on disk
// over the next ~30s and the Teams panel's poll surfaces it.
export async function POST(req: Request) {
  const { cwd, prompt } = await req
    .json()
    .catch(() => ({}) as { cwd?: string; prompt?: string });
  if (!cwd || !prompt)
    return Response.json({ ok: false, error: "cwd and prompt are required" }, { status: 400 });
  return Response.json(spawnTeam(cwd, prompt));
}

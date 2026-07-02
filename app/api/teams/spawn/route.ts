import { spawnTeam } from "@/lib/team-tmux";
import { expandHome, safeWorkspace } from "@/lib/config";
import { existsSync, statSync } from "node:fs";

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
  // Contain the launch dir the SAME way /api/terminal/repl's `new` action does
  // (SEC-4): a spawned team inherits the cwd's full trust — its CLAUDE.md,
  // .git/hooks, .claude/settings.json all load/execute — so an arbitrary or
  // planted cwd is a code-exec vector. Expand ~, require a real dir inside $HOME.
  const resolved = expandHome(String(cwd).trim());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory())
    return Response.json({ ok: false, error: `no such folder: ${resolved}` }, { status: 400 });
  const safe = safeWorkspace(resolved);
  if (!safe)
    return Response.json({ ok: false, error: `folder not allowed: ${resolved}` }, { status: 403 });
  return Response.json(spawnTeam(safe, prompt));
}

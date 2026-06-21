import { NextResponse } from "next/server";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  projectsRoot,
  defaultWorkspace,
  sanitizeProjectName,
  expandHome,
  ensureDir,
  safeWorkspace,
} from "@/lib/config";
import {
  ensureRepl,
  startNewSession,
  sendTurn,
  stopRepl,
  replStatus,
  resolvePermission,
  reapIdle,
  type PermissionDecision,
} from "@/lib/repl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Control plane for the live REPL. GET = status; POST actions:
//   start  — take the wheel (spawn/keep the warm process)
//   send   — write a user turn into it ({text, images})
//   stop   — release it (kill the process)
//   answer — the browser's verdict on a permission ask ({tool_use_id, decision})
// The SSE feed lives at /api/terminal/repl/stream; the shim hits /permission.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  if (!id) return new NextResponse("session required", { status: 400 });
  return NextResponse.json(replStatus(id));
}

export async function POST(req: Request) {
  reapIdle();
  const body = await req.json().catch(() => null);
  const action: string | undefined = body?.action;
  if (!action) return new NextResponse("action required", { status: 400 });

  // "new" — birth a fresh session in a project dir and DRIVE it (no TUI). Returns
  // the real session id once the process inits; the UI pins + drives by it.
  if (action === "new") {
    // Resolve the launch dir. INVARIANT: never the bare home dir — Claude Code
    // fixes cwd at launch and can't re-anchor, so this is the one decision point.
    //   body.cwd        → an existing folder (a launcher chip), existence-checked
    //   body.newProject → create <projectsRoot>/<name> and start there
    //   body.project    → legacy bare name under projectsRoot (existence-checked)
    //   (nothing)       → the default workspace (~/hq), created if missing
    let cwd: string;
    try {
      if (typeof body.cwd === "string" && body.cwd.trim()) {
        cwd = expandHome(body.cwd.trim());
        if (!existsSync(cwd) || !statSync(cwd).isDirectory())
          return new NextResponse(`no such folder: ${cwd}`, { status: 400 });
      } else if (typeof body.newProject === "string" && body.newProject.trim()) {
        const name = sanitizeProjectName(body.newProject);
        if (!name) return new NextResponse("invalid project name", { status: 400 });
        cwd = ensureDir(join(projectsRoot(), name));
      } else if (typeof body.project === "string" && body.project.trim()) {
        cwd = join(projectsRoot(), body.project.trim());
        if (!existsSync(cwd) || !statSync(cwd).isDirectory())
          return new NextResponse(`no such project: ${cwd}`, { status: 400 });
      } else {
        cwd = ensureDir(defaultWorkspace()); // ~/hq — never the bare home dir
      }
    } catch (e) {
      return new NextResponse(e instanceof Error ? e.message : String(e), { status: 500 });
    }
    // Final gate: whatever branch produced `cwd`, it must resolve inside the
    // user's home tree — block /etc, other users, planted repos (CODE-REVIEW SEC-4).
    const safeCwd = safeWorkspace(cwd);
    if (!safeCwd) return new NextResponse(`folder not allowed: ${cwd}`, { status: 403 });
    cwd = safeCwd;
    try {
      const sessionId = startNewSession(cwd, { model: body.model });
      return NextResponse.json({ ok: true, sessionId, cwd });
    } catch (e) {
      return new NextResponse(e instanceof Error ? e.message : String(e), { status: 500 });
    }
  }

  const session: string | undefined = body?.session;
  if (!session) return new NextResponse("session required", { status: 400 });

  if (action === "start") {
    ensureRepl(session, { model: body.model });
    return NextResponse.json({ ok: true, status: replStatus(session) });
  }
  if (action === "send") {
    ensureRepl(session, { model: body.model }); // idempotent — starts if needed
    const ok = sendTurn(session, { text: body.text ?? "", images: body.images ?? [] });
    return NextResponse.json({ ok });
  }
  if (action === "stop") {
    return NextResponse.json({ ok: stopRepl(session) });
  }
  if (action === "answer") {
    const decision = body.decision as PermissionDecision;
    const ok = resolvePermission(session, String(body.tool_use_id), decision);
    return NextResponse.json({ ok });
  }
  return new NextResponse("unknown action", { status: 400 });
}

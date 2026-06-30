import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { pidFor } from "@/lib/session-pids";

export const dynamic = "force-dynamic";

// POST /api/terminal/close-tui { session } → SIGTERM the Claude Code terminal that
// owns this session, so hq can take it over as a clean continuation (no fork). The
// PID comes from the SessionStart hook's sidecar; we re-verify it's still a live
// `claude` before killing so a recycled PID can't take out the wrong process.
export async function POST(req: Request) {
  const { session } = await req.json().catch(() => ({}) as { session?: string });
  if (!session) return NextResponse.json({ ok: false, error: "no session id" }, { status: 400 });

  const pid = pidFor(session);
  if (!pid)
    return NextResponse.json({
      ok: false,
      error: "no PID on record — this terminal started before PID capture (a new session will work)",
    });

  let comm = "";
  try {
    comm = execSync(`ps -p ${pid} -o comm=`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim().split("/").pop() ?? "";
  } catch {
    /* not running */
  }
  if (comm !== "claude")
    return NextResponse.json({ ok: false, error: "the terminal's process is no longer running" });

  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    return NextResponse.json({ ok: false, error: `couldn't stop the terminal: ${String(e)}` });
  }
  return NextResponse.json({ ok: true, killed: pid });
}

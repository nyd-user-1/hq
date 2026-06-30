import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { tuiFor } from "@/lib/session-pids";

export const dynamic = "force-dynamic";

// POST /api/terminal/close-tui { session } → hand-off: close the Claude Code
// terminal that owns this session so hq can continue it as a clean single thread.
//
// Two steps, because killing the process is NOT the same as closing the window:
//  1. SIGTERM the claude process (it exits, leaving just the shell in the tab).
//  2. If we know the tab's TTY (captured by the SessionStart hook), drive
//     Terminal.app to CLOSE that tab — otherwise the window lingers showing
//     claude's "Resume this session with…" hint. With claude already gone, only
//     the shell remains, so the close needs no "processes still running" prompt.
//
// The PID/TTY come from the hook's sidecar; we re-verify the PID is still a live
// `claude` before killing so a recycled PID can't take out the wrong process.
// Closing the tab only works for Terminal.app; for any other terminal we still
// SIGTERM (the old behavior) and report that the window was left open.
export async function POST(req: Request) {
  const { session } = await req.json().catch(() => ({}) as { session?: string });
  if (!session) return NextResponse.json({ ok: false, error: "no session id" }, { status: 400 });

  const tui = tuiFor(session);
  if (!tui)
    return NextResponse.json({
      ok: false,
      error: "no terminal on record — this session started before PID capture (a new session will work)",
    });

  let comm = "";
  try {
    comm = execSync(`ps -p ${tui.pid} -o comm=`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim().split("/").pop() ?? "";
  } catch {
    /* not running */
  }
  if (comm !== "claude")
    return NextResponse.json({ ok: false, error: "the terminal's process is no longer running" });

  try {
    process.kill(tui.pid, "SIGTERM");
  } catch (e) {
    return NextResponse.json({ ok: false, error: `couldn't stop the terminal: ${String(e)}` });
  }

  // Try to close the actual Terminal.app tab. Only attempt when the TTY looks
  // sane (alphanumeric, e.g. "ttys001") so it can't be smuggled into osascript.
  let windowClosed = false;
  if (/^[a-zA-Z0-9]+$/.test(tui.tty)) {
    const osa = [
      'tell application "Terminal"',
      `  set targetTty to "/dev/${tui.tty}"`,
      "  repeat with w in windows",
      "    repeat with t in (tabs of w)",
      "      try",
      "        if (tty of t) is targetTty then",
      "          close w saving no",
      '          return "closed"',
      "        end if",
      "      end try",
      "    end repeat",
      "  end repeat",
      "end tell",
      'return "notfound"',
    ].join("\n");
    try {
      // Brief beat so the SIGTERM'd claude has dropped back to the shell before we
      // close (avoids Terminal's running-process confirmation).
      const out = execSync(`osascript -e ${JSON.stringify(osa)}`, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 4000,
      })
        .toString()
        .trim();
      windowClosed = out === "closed";
    } catch {
      /* not Terminal.app, scripting denied, or timed out — process is still gone */
    }
  }

  return NextResponse.json({ ok: true, killed: tui.pid, windowClosed });
}

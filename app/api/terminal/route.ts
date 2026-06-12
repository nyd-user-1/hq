import { execFile, type ChildProcess } from "node:child_process";
import { NextResponse } from "next/server";

export const maxDuration = 300; // Vercel hobby cap; locally the dev server has no limit

// HQ-spawned headless runs, keyed by the session id they were asked to resume.
// Lets DELETE kill a runaway — HQ can only stop runs IT spawned, not sessions
// it merely observes.
const running = new Map<string, ChildProcess>();

// Spawns a headless `claude --resume` — a separate process that can edit the
// resumed project's repo in parallel with any live terminal (the 001.8
// incident). GUARDED: the caller must name its target session explicitly; the
// implicit "newest" fallback is gone, and the UI confirms before posting here.
export async function POST(req: Request) {
  const { prompt, sessionId } = await req.json();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return new NextResponse("empty prompt", { status: 400 });
  }
  if (typeof sessionId !== "string" || !sessionId) {
    return new NextResponse(
      "send requires an explicit session id — pin a session first",
      { status: 400 }
    );
  }
  if (running.has(sessionId)) {
    return new NextResponse("a send to this session is already running", {
      status: 409,
    });
  }

  try {
    const out = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "claude",
        ["--resume", sessionId, "-p", prompt],
        {
          cwd: process.env.HOME,
          timeout: 590_000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env },
        },
        (err, stdout, stderr) => {
          running.delete(sessionId);
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        }
      );
      running.set(sessionId, child);
    });
    return NextResponse.json({ ok: true, output: out });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : String(e), {
      status: 500,
    });
  }
}

// Stop an HQ-spawned run: kill the child for ?session=<id>.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  if (!id) return new NextResponse("session id required", { status: 400 });
  const child = running.get(id);
  if (!child) {
    return new NextResponse("no HQ-spawned run for that session", {
      status: 404,
    });
  }
  child.kill("SIGTERM");
  running.delete(id);
  return NextResponse.json({ ok: true, stopped: true });
}

import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { latestSessionId } from "@/lib/transcript";

export const maxDuration = 300; // Vercel hobby cap; locally the dev server has no limit

// Continues the newest session headlessly. Resume forks to a new session
// file that carries the full history, so the transcript view follows along.
export async function POST(req: Request) {
  const { prompt, sessionId: pinned } = await req.json();
  if (typeof prompt !== "string" || !prompt.trim()) {
    return new NextResponse("empty prompt", { status: 400 });
  }
  const sessionId =
    typeof pinned === "string" && pinned ? pinned : latestSessionId();
  if (!sessionId) {
    return new NextResponse("no session transcript found", { status: 404 });
  }

  const args = ["--resume", sessionId, "-p", prompt];
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        "claude",
        args,
        {
          cwd: process.env.HOME,
          timeout: 590_000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env },
        },
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        }
      );
    });
    return NextResponse.json({ ok: true, output: out });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : String(e), {
      status: 500,
    });
  }
}

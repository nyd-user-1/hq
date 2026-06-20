import { NextResponse } from "next/server";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  spawnChannelSession,
  listChannelSessions,
  killChannelSession,
  sendToChannel,
  decidePermission,
  channelHealth,
  resolveSessionId,
} from "@/lib/channel";
import { readPolicy, writePolicy } from "@/lib/channel-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Control plane for HQ-driven CHANNEL sessions (Option B). Modeled on
// app/api/terminal/repl. GET = health + tracked sessions + the auto-mode policy.
// POST actions:
//   spawn   — launch `claude --dangerously-load-development-channels server:hq` in a cwd
//   send    — push a prompt into the running session (via the sidecar)
//   decide  — answer a relayed permission prompt {request_id, behavior}
//   kill    — SIGTERM a tracked session by pid
//   resolve — (re)resolve a session's transcript id from disk by pid
//   policy  — write the auto-mode classifier policy
// The SSE feed (permission asks, auto-decisions, acks) proxies at /api/channel/stream.
export async function GET() {
  const health = await channelHealth();
  return NextResponse.json({
    health,
    sessions: listChannelSessions(),
    policy: readPolicy(),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const action: string | undefined = body?.action;
  if (!action) return new NextResponse("action required", { status: 400 });

  if (action === "spawn") {
    const project: string | undefined = body.project;
    const cwd: string | undefined = body.cwd ?? (project ? join(homedir(), "code", project) : undefined);
    if (!cwd) return new NextResponse("project or cwd required", { status: 400 });
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return new NextResponse(`no such project dir: ${cwd}`, { status: 400 });
    }
    const result = spawnChannelSession({ cwd, prompt: body.prompt, model: body.model });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "send") {
    const text: string = body.text ?? "";
    if (!text.trim()) return new NextResponse("text required", { status: 400 });
    return NextResponse.json(await sendToChannel(text));
  }

  if (action === "decide") {
    const request_id = String(body.request_id ?? "");
    const behavior = body.behavior === "allow" ? "allow" : body.behavior === "deny" ? "deny" : null;
    if (!request_id || !behavior) {
      return new NextResponse("request_id + behavior required", { status: 400 });
    }
    return NextResponse.json(await decidePermission(request_id, behavior));
  }

  if (action === "kill") {
    const pid = Number(body.pid);
    if (!pid) return new NextResponse("pid required", { status: 400 });
    return NextResponse.json(killChannelSession(pid));
  }

  if (action === "resolve") {
    const pid = Number(body.pid);
    if (!pid) return new NextResponse("pid required", { status: 400 });
    return NextResponse.json({ sessionId: resolveSessionId(pid) });
  }

  if (action === "policy") {
    if (!body.policy || typeof body.policy !== "object") {
      return new NextResponse("policy object required", { status: 400 });
    }
    return NextResponse.json({ ok: true, policy: writePolicy(body.policy) });
  }

  return new NextResponse("unknown action", { status: 400 });
}

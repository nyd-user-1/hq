import { NextResponse } from "next/server";
import {
  recordEvent,
  sessionSpans,
  recentActivity,
  subagentRuns,
  isKnownKind,
} from "@/lib/events";

export const dynamic = "force-dynamic";

// HQ's hook-event SINK — the real-time data layer. Claude Code hooks (SessionStart
// via the scripts/hooks/session-events.mjs command bridge; every other event via a
// native type:"http" hook) POST their raw JSON here. We normalize + append one
// NDJSON line to ~/.claude/hq/events.ndjson (lib/events.ts). Hooks are fire-and-
// forget, so we validate cheaply, never throw on a bad body, return 200 fast, and
// NEVER send a decision body (HQ is a pure observer — it must not block/deny a
// tool call or a stop).
//
// Registration is OPT-IN — HQ does not touch your settings.json. See the /cmd snippet.

export async function POST(req: Request) {
  // Never throw on a malformed body — a hook firing into a half-up server, or a
  // stray probe, must not 500.
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 200 });
  }
  if (!isKnownKind((body as { hook_event_name?: unknown }).hook_event_name)) {
    // Unknown / unsupported event — accept-and-ignore so the hook never errors.
    return NextResponse.json({ ok: false, error: "unknown event" }, { status: 200 });
  }
  const ev = recordEvent(body);
  return NextResponse.json({ ok: !!ev, id: ev?.id ?? null });
}

// The read side for HQ's surfaces (Firehose feed, Sessions overlay, subagent tree):
// the folded session spans, the newest activity across all kinds, and the subagent
// fan-out. ?session= scopes activity + subagents to one session; ?limit= caps the feed.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = url.searchParams.get("session") || undefined;
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  return NextResponse.json({
    spans: sessionSpans(),
    activity: recentActivity(limit, session),
    subagents: subagentRuns(session),
  });
}

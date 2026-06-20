import { NextResponse } from "next/server";
import { recordEvent, sessionSpans, isKnownKind } from "@/lib/events";

export const dynamic = "force-dynamic";

// HQ's session-event SINK. Claude Code hooks (SessionStart via the
// scripts/hooks/session-events.mjs command hook; SessionEnd via a native
// type:"http" hook) POST their raw JSON here. We normalize + append one NDJSON
// line to ~/.claude/hq/events.ndjson (lib/events.ts). Hooks are fire-and-forget,
// so we validate cheaply, never throw on a bad body, and return 200 fast.
//
// Registration is OPT-IN — HQ does not touch your settings.json. See the snippet
// at the top of scripts/hooks/session-events.mjs (and the /install page).

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

// Debug / future Sessions overlay: the folded SessionStart→SessionEnd spans.
export async function GET() {
  return NextResponse.json({ spans: sessionSpans() });
}

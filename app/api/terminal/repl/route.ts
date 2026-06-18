import { NextResponse } from "next/server";
import {
  ensureRepl,
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
  const session: string | undefined = body?.session;
  const action: string | undefined = body?.action;
  if (!session || !action) {
    return new NextResponse("action + session required", { status: 400 });
  }

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

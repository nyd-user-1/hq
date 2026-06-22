import { NextResponse } from "next/server";
import {
  getBlockMeta,
  setBlockMeta,
  appendFeedback,
  type Reaction,
} from "@/lib/block-meta";

export const dynamic = "force-dynamic";

// HQ-native per-message-block view state (favorite / hide / 👍👎). A sidecar at
// ~/.claude/hq/block-meta.json — NOT a write into Claude Code's transcripts. The
// terminal hydrates a session's map on load (GET ?session=) and POSTs a per-block
// patch. A 👍/👎 also appends to ~/.claude/hq/feedback.jsonl (the durable record).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session = searchParams.get("session") ?? "";
  if (!session) return NextResponse.json({ meta: {} });
  return NextResponse.json({ meta: getBlockMeta(session) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sessionId, blockId, favorite, hidden, reaction, text, project } = body;
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof blockId !== "string" ||
    !blockId
  ) {
    return new NextResponse("sessionId and blockId required", { status: 400 });
  }

  const patch: { favorite?: boolean; hidden?: boolean; reaction?: Reaction | null } = {};
  if (typeof favorite === "boolean") patch.favorite = favorite;
  if (typeof hidden === "boolean") patch.hidden = hidden;
  if (reaction === "up" || reaction === "down" || reaction === null) patch.reaction = reaction;

  const meta = setBlockMeta(sessionId, blockId, patch);

  // A real 👍/👎 (not a clear) also lands in the durable, Claude-readable log.
  if (reaction === "up" || reaction === "down") {
    appendFeedback({
      reaction,
      sessionId,
      blockId,
      text: typeof text === "string" ? text.slice(0, 600) : undefined,
      project: typeof project === "string" ? project : undefined,
    });
  }

  return NextResponse.json({ meta });
}

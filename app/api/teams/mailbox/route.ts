import { randomUUID } from "node:crypto";
import { mailboxFor, sendMail } from "@/lib/mailbox";

export const dynamic = "force-dynamic";

// The team MAILBOX feed — hq watching the agents coordinate, reading what Claude
// wrote to disk (~/.claude/teams/<id>/inboxes/*.json).
//   GET  ?team=<id>            → { messages }   (every inbox, newest first)
//   POST { team, to, text, from? } → { ok }     (message a member — alt drive path)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const team = url.searchParams.get("team") ?? "";
  return Response.json({ messages: mailboxFor(team) });
}

export async function POST(req: Request) {
  const { team, to, text, from } = await req
    .json()
    .catch(() => ({}) as { team?: string; to?: string; text?: string; from?: string });
  if (!team || !to || !text)
    return Response.json({ ok: false, error: "team, to and text are required" }, { status: 400 });
  return Response.json(
    sendMail(team, to, from ?? "hq", text, randomUUID(), new Date().toISOString()),
  );
}

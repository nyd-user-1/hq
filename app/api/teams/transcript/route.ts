import fs from "node:fs";
import { teams, teamMemberTranscript } from "@/lib/teams";

// Read-only teammate transcript for the wall's teammate pane. hq's thesis: read
// what Claude wrote to disk. A teammate's transcript is the normal CC JSONL shape
// living under the lead session (resolved by lib/teams.ts). We tail it, parse the
// last few turns, and infer whether the teammate is mid-turn. node:fs only.
export const dynamic = "force-dynamic";

const TAIL_BYTES = 2 * 1024 * 1024; // bound the read so a long transcript stays cheap on a 2s poll
const FINAL_STOPS = new Set(["end_turn", "stop_sequence", "max_tokens"]);
const FRESH_MS = 30_000;

type Turn = { role: "user" | "assistant"; text: string; at: string };

type Block = { type?: string; text?: string; name?: string };
type Entry = {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: { content?: unknown; stop_reason?: string | null };
};

const EMPTY = { turns: [] as Turn[], working: false };

// Flatten a message's content into text. Assistant prose comes through as-is;
// each tool call is folded in as a "⏺ <ToolName>" line so the pane shows the
// teammate's activity, not just its words.
function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const b of content as Block[]) {
    if (b?.type === "text" && typeof b.text === "string") out.push(b.text);
    else if (b?.type === "tool_use" && b.name) out.push(`⏺ ${b.name}`);
  }
  return out.join("\n");
}

function strip(s: string): string {
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const team = url.searchParams.get("team") ?? "";
    const member = url.searchParams.get("member") ?? "";

    const t = teams().find((x) => x.id === team);
    if (!t) return Response.json(EMPTY);

    const file = teamMemberTranscript(t, member);
    if (!file) return Response.json(EMPTY);

    // Tail the file (most-recent content is all the pane shows), dropping the
    // first partial line when we start mid-file.
    const st = fs.statSync(file);
    const startAt = Math.max(0, st.size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    if (startAt > 0) lines.shift();

    const turns: Turn[] = [];
    const msgs: Entry[] = []; // user/assistant entries, in order — for the working heuristic
    for (const line of lines) {
      if (!line) continue;
      let e: Entry;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      // NOTE: a teammate transcript is ENTIRELY sidechain rows (that IS what a
      // subagent/teammate transcript is) — so we must NOT skip isSidechain here,
      // or every turn vanishes. The teammate's own turns are exactly what we show.
      if (e.type !== "user" && e.type !== "assistant") continue;
      msgs.push(e);
      const text = strip(blockText(e.message?.content));
      if (!text) continue; // tool-result-only user rows, empty acks
      turns.push({ role: e.type, text, at: e.timestamp ?? "" });
    }

    // working: the last message is an assistant turn that hasn't reached a final
    // stop (so a result/continuation is still owed), OR the file changed within
    // the last ~30s and the last message isn't a final result. Simple + defensive.
    const last = msgs[msgs.length - 1];
    const stop = last?.message?.stop_reason ?? null;
    const finalResult = last?.type === "assistant" && stop !== null && FINAL_STOPS.has(stop);
    const fresh = Date.now() - st.mtimeMs < FRESH_MS;
    const working = !!last && !finalResult && (last.type === "assistant" || fresh);

    return Response.json({
      turns: turns.slice(-40),
      working,
      name: member,
      color: t.members.find((m) => m.name === member)?.color ?? "",
    });
  } catch {
    return Response.json(EMPTY);
  }
}

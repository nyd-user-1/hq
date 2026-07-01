import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

// THE TEAM MAILBOX — the inter-agent messaging behind Claude Code's agent teams.
// Every member has an inbox file; messages land there and are consumed (marked
// read) by the member's runtime. hq READS them to surface a live feed of the
// team's coordination — who said what to whom — and can WRITE one to message a
// member (an alternate drive path, esp. for in-process teammates with no pane).
//
//   ~/.claude/teams/<teamId>/inboxes/<member>.json   ← a JSON array of messages
//
// One message (verified on disk):
//   { "from":"test", "text":"…", "timestamp":"2026-…Z", "color":"yellow",
//     "msgV":1, "msg_id":"<uuid>", "type":"message", "read":false }
// `text` is usually prose, but a structured payload (task assignment, etc.) is a
// JSON string — we summarize those into a readable line. Defensive per-file so one
// bad inbox never sinks the feed; returns [] when the team has no inboxes dir.

const TEAMS_DIR = path.join(os.homedir(), ".claude", "teams");

export type MailMessage = {
  to: string; // the inbox owner (the recipient) — the filename stem
  from: string; // the sender's member name
  text: string; // human-readable body (structured payloads summarized)
  raw: string; // the original text, untouched
  kind: string; // "message" | "task_assignment" | … (the payload type)
  at: string; // ISO timestamp ("" when absent)
  read: boolean; // the runtime consumed it
  color: string; // the sender's CC color ("" when absent)
  id: string; // msg_id (stable key)
};

type RawMessage = {
  from?: unknown;
  text?: unknown;
  timestamp?: unknown;
  color?: unknown;
  msg_id?: unknown;
  type?: unknown;
  read?: unknown;
};

// A structured `text` payload (a JSON string with a `type`) → a one-line summary.
// Plain prose passes through untouched.
function summarize(text: string): { text: string; kind: string } {
  const t = (text ?? "").trim();
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (o && typeof o === "object" && typeof o.type === "string") {
        if (o.type === "task_assignment")
          return {
            text: `assigned task #${o.taskId ?? "?"}: ${o.subject ?? ""}`.trim(),
            kind: "task_assignment",
          };
        const body = (o.subject || o.text || o.message || o.reason || "") as string;
        return { text: body ? `${o.type}: ${body}` : o.type, kind: o.type };
      }
    } catch {
      /* not JSON after all — treat as prose */
    }
  }
  return { text: t, kind: "message" };
}

// Every message across a team's inboxes, newest first (capped). teamId is
// basename()'d so a crafted id can't escape the teams dir.
export function mailboxFor(teamId: string, limit = 100): MailMessage[] {
  if (!teamId) return [];
  const dir = path.join(TEAMS_DIR, path.basename(teamId), "inboxes");
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return []; // no inboxes/ — the team has had no traffic (or doesn't exist)
  }
  const out: MailMessage[] = [];
  for (const f of files) {
    if (!f.endsWith(".json") || f.startsWith(".")) continue;
    const to = f.replace(/\.json$/, "");
    let arr: unknown;
    try {
      arr = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue; // unreadable / mid-write
    }
    if (!Array.isArray(arr)) continue;
    for (const m of arr as RawMessage[]) {
      if (!m || typeof m !== "object") continue;
      const rawText = typeof m.text === "string" ? m.text : "";
      const { text, kind } = summarize(rawText);
      out.push({
        to,
        from: typeof m.from === "string" ? m.from : "",
        text,
        raw: rawText,
        kind: typeof m.type === "string" && m.type !== "message" ? m.type : kind,
        at: typeof m.timestamp === "string" ? m.timestamp : "",
        read: m.read === true,
        color: typeof m.color === "string" ? m.color : "",
        id: typeof m.msg_id === "string" ? m.msg_id : "",
      });
    }
  }
  // Newest first (ISO `at` sorts lexically); blank `at` sinks to the bottom.
  out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return out.slice(0, limit);
}

// Append a message to a member's inbox — hq messaging a teammate. Best-effort,
// atomic (read → append → tmp → rename) so a concurrent runtime write isn't
// shredded. Returns false when the team/inbox can't be resolved. The shape mirrors
// what Claude Code writes, so the member's runtime consumes it as a normal message.
export function sendMail(
  teamId: string,
  to: string,
  from: string,
  text: string,
  id: string,
  at: string,
): { ok: boolean; error?: string } {
  const team = path.basename((teamId ?? "").trim());
  const member = path.basename((to ?? "").trim());
  const body = (text ?? "").trim();
  if (!team || !member) return { ok: false, error: "team and member are required" };
  if (!body) return { ok: false, error: "empty message" };
  const dir = path.join(TEAMS_DIR, team, "inboxes");
  const file = path.join(dir, `${member}.json`);
  try {
    // Only message an EXISTING inbox — never mint a member out of a bad name.
    if (!fs.existsSync(file)) return { ok: false, error: `no inbox for "${member}"` };
    let arr: unknown;
    try {
      arr = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      arr = [];
    }
    const list = Array.isArray(arr) ? arr : [];
    list.push({
      from: from || "hq",
      text: body,
      timestamp: at,
      color: "",
      msgV: 1,
      msg_id: id,
      type: "message",
      read: false,
    });
    const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`; // unique — concurrent sends can't race the temp
    fs.writeFileSync(tmp, JSON.stringify(list));
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}

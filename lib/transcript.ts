import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Live view of the current Claude Code session: the newest transcript in
// ~/.claude/projects/<cwd-slug>/ is the active conversation. Read its tail,
// keep only real user/assistant text (no tool calls, no command wrappers).

const SESSIONS_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects",
  "-Users-brendanstanton"
);
const TAIL_BYTES = 8 * 1024 * 1024;

export type Turn = { role: "user" | "assistant"; text: string; at: string };

export function latestSessionId(): string | null {
  let best: { id: string; mtime: number } | null = null;
  for (const f of fs.readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith(".jsonl")) continue;
    const mtime = fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs;
    if (!best || mtime > best.mtime) best = { id: f.slice(0, -6), mtime };
  }
  return best?.id ?? null;
}

function blocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function clean(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

export function recentTurns(count: number): Turn[] {
  const id = latestSessionId();
  if (!id) return [];
  const file = path.join(SESSIONS_DIR, `${id}.jsonl`);
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);

  const lines = buf.toString("utf8").split("\n");
  if (start > 0) lines.shift(); // first line is partial

  const turns: Turn[] = [];
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const text = clean(blocksToText(entry.message?.content));
    if (!text) continue;
    // skip slash-command wrappers and their stdout echoes
    if (text.includes("<command-name>") || text.includes("<local-command-stdout>"))
      continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === entry.type) {
      // streaming splits one reply across entries — merge same-role runs
      prev.text += `\n\n${text}`;
    } else {
      turns.push({ role: entry.type, text, at: entry.timestamp ?? "" });
    }
  }
  return turns.slice(-count);
}

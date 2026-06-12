import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Live view of the current Claude Code session: the newest transcript in
// ~/.claude/projects/<cwd-slug>/ is the active conversation. Read its tail,
// keep only real user/assistant text (no tool calls, no command wrappers).

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const SESSIONS_DIR = path.join(PROJECTS_ROOT, "-Users-brendanstanton");
const TAIL_BYTES = 8 * 1024 * 1024;

export type Turn = { role: "user" | "assistant"; text: string; at: string };

export function latestSessionId(): string | null {
  let best: { id: string; mtime: number } | null = null;
  let names: string[];
  try {
    names = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return null; // no transcripts on this machine (e.g. deployed)
  }
  for (const f of names) {
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

export type CommandRun = {
  command: string; // "/code-review"
  arg: string; // trailing args, if any
  at: string;
  project: string;
};

// Recent Runs: slash-command invocations across the newest transcripts, both
// forms — interactive <command-name>/foo</command-name> and the headless
// `claude -p /foo` fires the skill/bucket buttons send. Machine-wide, newest first.
export function recentCommands(limit = 8): CommandRun[] {
  const files: { file: string; mtime: number }[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        files.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      } catch {
        // vanished mid-scan
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const runs: CommandRun[] = [];
  for (const { file } of files.slice(0, 8)) {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - 128 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();

    let project = "";
    for (const line of lines) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (!project && typeof e.cwd === "string")
        project = e.cwd === os.homedir() ? "~" : path.basename(e.cwd);
      if (e.type !== "user" || e.isSidechain) continue;
      const raw = blocksToText(e.message?.content);
      if (!raw) continue;
      const tag = raw.match(/<command-name>\s*\/?([\w-]+)\s*<\/command-name>/);
      const bare = clean(raw).match(/^\/([\w-]+)(?:\s+([\s\S]+))?$/);
      const m = tag ? { name: tag[1], arg: "" } : bare ? { name: bare[1], arg: bare[2] ?? "" } : null;
      if (!m) continue;
      runs.push({
        command: `/${m.name}`,
        arg: m.arg.replace(/\s+/g, " ").trim().slice(0, 60),
        at: e.timestamp ?? "",
        project,
      });
    }
  }
  return runs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

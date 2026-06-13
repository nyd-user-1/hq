#!/usr/bin/env node
// Read-only live tail of a Claude Code session transcript, pretty-printed for
// a real terminal window. Follow-along only — typing here does nothing; the
// session is driven elsewhere (HQ sends, or its own claude terminal).
//
//   node scripts/follow.mjs <session-id-or-prefix>
//   node scripts/follow.mjs            # newest session on the machine

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const POLL_MS = 500;
const BACKLOG_BYTES = 256 * 1024;

const BLUE = "\x1b[34m";
const ORANGE = "\x1b[38;5;208m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function allSessions() {
  const out = [];
  for (const dir of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        out.push({ id: f.slice(0, -6), file: full, mtime: fs.statSync(full).mtimeMs });
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const want = process.argv[2];
const session = want
  ? allSessions().find((s) => s.id.startsWith(want))
  : allSessions()[0];
if (!session) {
  console.error(`no session matching "${want ?? "(newest)"}"`);
  process.exit(1);
}

const time = (ts) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";

const clean = (t) =>
  t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();

let lastRole = null;

function printEntry(e) {
  if (e.isSidechain) return;
  if (e.type !== "user" && e.type !== "assistant") return;
  const c = e.message?.content;
  const blocks = Array.isArray(c) ? c : [];

  if (e.type === "user") {
    if (blocks.some((b) => b?.type === "tool_result")) return;
    const raw = typeof c === "string" ? c : blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
    const cmd = raw.match(/<command-name>([^<]*)<\/command-name>/);
    if (cmd) {
      console.log(`${DIM}── ${cmd[1].trim()} · ${time(e.timestamp)} ──${RESET}\n`);
      lastRole = null;
      return;
    }
    if (raw.includes("<local-command-stdout>")) return;
    const t = clean(raw);
    if (!t) return;
    if (lastRole !== "user")
      console.log(`${BLUE}${BOLD}● brendan${RESET} ${DIM}${time(e.timestamp)}${RESET}`);
    console.log(t + "\n");
    lastRole = "user";
    return;
  }

  for (const b of blocks) {
    if (b?.type === "text" && (b.text ?? "").trim()) {
      if (lastRole !== "assistant")
        console.log(`${ORANGE}${BOLD}● claude${RESET} ${DIM}${time(e.timestamp)}${RESET}`);
      console.log(b.text.trim() + "\n");
      lastRole = "assistant";
    } else if (b?.type === "tool_use") {
      const input = b.input ?? {};
      const title =
        input.file_path?.split("/").pop() ??
        input.command?.split("\n")[0]?.slice(0, 80) ??
        input.pattern ??
        input.description ??
        "";
      console.log(`${DIM}  › ${b.name}${title ? ` · ${title}` : ""}${RESET}`);
      lastRole = "tool";
    }
  }
}

let buffer = "";
function consume(text) {
  buffer += text;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? ""; // keep the trailing partial line
  for (const line of lines) {
    if (!line) continue;
    try {
      printEntry(JSON.parse(line));
    } catch {}
  }
}

console.log(`${DIM}following ${session.id} — read-only · the session is driven elsewhere · ^C to quit${RESET}\n`);

let offset = Math.max(0, fs.statSync(session.file).size - BACKLOG_BYTES);
const readNew = () => {
  let size;
  try {
    size = fs.statSync(session.file).size;
  } catch {
    return; // transcript vanished — keep waiting
  }
  if (size <= offset) return;
  const fd = fs.openSync(session.file, "r");
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  consume(buf.toString("utf8"));
};

if (offset > 0) {
  // mid-file start: skip the first (truncated) line of the backlog
  const fd = fs.openSync(session.file, "r");
  const buf = Buffer.alloc(fs.statSync(session.file).size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset += buf.length;
  consume(buf.toString("utf8").split("\n").slice(1).join("\n"));
} else {
  readNew();
}

setInterval(readNew, POLL_MS);

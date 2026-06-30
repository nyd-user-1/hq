#!/usr/bin/env node
// SessionStart hook: record {session_id → {pid, tty}} for the claude TUI that owns
// this session, so hq can close the terminal for a clean hand-off (the "Close
// terminal & continue here" button). The hook runs as a descendant of `claude`;
// walk up the process tree to the nearest `claude` process and stash it.
//
// TWO guards make the record trustworthy:
//  1. We ONLY record a genuine INTERACTIVE TUI. hq's own warm REPL resumes a
//     session as `claude --resume <id> -p --input-format stream-json …`, which
//     ALSO fires SessionStart — recording its PID would clobber the human TUI's
//     entry (the "killed the wrong terminal" bug). So if the nearest `claude`
//     ancestor is a headless/print process, we exit WITHOUT writing.
//  2. We capture the controlling TTY (e.g. ttys001) so close-tui can drive the
//     terminal app to close that exact tab, not just SIGTERM the process.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ }
const sid = input.session_id;
if (!sid) process.exit(0);

const psField = (pid, field) => {
  try {
    return execSync(`ps -p ${pid} -o ${field}=`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch { return ""; }
};
const comm = (pid) => psField(pid, "comm").split("/").pop();
const ppidOf = (pid) => Number(psField(pid, "ppid")) || 0;

// Walk up to the nearest `claude` process.
let pid = process.ppid;
for (let i = 0; i < 8 && pid > 1; i++) {
  if (comm(pid) === "claude") break;
  const next = ppidOf(pid);
  if (!next || next <= 1) break;
  pid = next;
}
if (comm(pid) !== "claude") process.exit(0);

// GUARD 1: skip headless / hq-driven processes — only a real interactive TUI is a
// "terminal" the user can close. A print/stream-json resume is hq's own engine.
const args = psField(pid, "args");
if (/(?:^|\s)(?:-p|--print)(?:\s|$)/.test(args) || /--input-format/.test(args))
  process.exit(0);

// GUARD 2: capture the controlling TTY (bare, e.g. "ttys001"; blank when none).
let tty = psField(pid, "tty");
if (!tty || tty === "??" || tty === "?") tty = "";

try {
  const dir = join(homedir(), ".claude", "hq");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session-pids.json");
  let map = {};
  try { map = JSON.parse(readFileSync(file, "utf8")); } catch { /* fresh */ }
  map[sid] = { pid, tty };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(map));
  renameSync(tmp, file);
} catch { /* best-effort */ }
process.exit(0);

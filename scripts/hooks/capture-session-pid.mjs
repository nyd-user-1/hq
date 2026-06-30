#!/usr/bin/env node
// SessionStart hook: record {session_id → the claude TUI's PID} so hq can close
// the terminal for a clean hand-off (the "Close terminal & continue" button).
// The hook runs as a descendant of `claude`; walk up the process tree to the
// nearest `claude` process and stash its PID in ~/.claude/hq/session-pids.json.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no stdin */ }
const sid = input.session_id;
if (!sid) process.exit(0);

const comm = (pid) => {
  try { return execSync(`ps -p ${pid} -o comm=`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("/").pop(); }
  catch { return ""; }
};
const ppidOf = (pid) => {
  try { return Number(execSync(`ps -p ${pid} -o ppid=`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); }
  catch { return 0; }
};

let pid = process.ppid;
for (let i = 0; i < 8 && pid > 1; i++) {
  if (comm(pid) === "claude") break;
  const next = ppidOf(pid);
  if (!next || next <= 1) break;
  pid = next;
}

try {
  const dir = join(homedir(), ".claude", "hq");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session-pids.json");
  let map = {};
  try { map = JSON.parse(readFileSync(file, "utf8")); } catch { /* fresh */ }
  map[sid] = pid;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(map));
  renameSync(tmp, file);
} catch { /* best-effort */ }
process.exit(0);

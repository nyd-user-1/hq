import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { weighted } from "./usage";
import { callCost } from "./pricing";

// Recent API calls with per-call token cost + USD, from the newest transcripts.
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const TAIL = 256 * 1024;

export type Call = {
  at: string;
  project: string;
  output: number;
  raw: number;
  weightedTokens: number;
  cost: number; // estimated USD for this call
  premium: boolean; // past the 200k cliff → long-context surcharge applied
};

export function getCalls(limit = 25): Call[] {
  const files: { file: string; mtime: number }[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return []; // no transcripts on this machine (e.g. deployed)
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        files.push({
          file: path.join(dirPath, f),
          mtime: fs.statSync(path.join(dirPath, f)).mtimeMs,
        });
      } catch {
        // vanished mid-scan
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const calls: Call[] = [];
  for (const { file } of files.slice(0, 5)) {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - TAIL);
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
        project =
          e.cwd === os.homedir() ? "Unassigned" : path.basename(e.cwd);
      const u = e?.message?.usage;
      if (!u || !e.timestamp) continue;
      const t = {
        input: u.input_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        messages: 1,
      };
      const { usd, premium } = callCost({
        model: e.message?.model,
        input: t.input,
        cacheCreate: t.cacheCreate,
        cacheRead: t.cacheRead,
        output: t.output,
      });
      calls.push({
        at: e.timestamp,
        project,
        output: t.output,
        raw: t.input + t.cacheCreate + t.cacheRead + t.output,
        weightedTokens: weighted(t),
        cost: usd,
        premium,
      });
    }
  }
  return calls.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { weighted } from "./usage";
import { callCost } from "./pricing";
import { getSessionsMeta, type SessionsMeta } from "./sessions-meta";

// Recent API calls with per-call token cost + USD, from the newest transcripts.
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const TAIL = 256 * 1024;

// The HQ usage-capture hook stamps this on its probe's user turn so those
// throwaway calls read as "hook · usage" in the ledger instead of mystery rows.
// Keep in sync with the hook script (scripts/hooks/usage-capture.sh).
export const USAGE_PROBE_SENTINEL = "hq-usage-probe";

// What a call was FOR, inferred from transcript signals: entrypoint (cli vs
// sdk-cli = headless/HQ-driven), isSidechain (a subagent turn), and the probe
// sentinel. "interactive" is the unlabeled default (a normal typed turn).
export type CallKind = "interactive" | "headless" | "subagent" | "hook/usage";
const KIND_LABEL: Record<CallKind, string> = {
  interactive: "",
  headless: "headless",
  subagent: "subagent",
  "hook/usage": "hook · usage",
};

export type Call = {
  at: string;
  project: string;
  kind: CallKind;
  label: string; // KIND_LABEL[kind] — the human purpose tag ("" for interactive)
  output: number;
  raw: number;
  weightedTokens: number;
  cost: number; // estimated USD for this call
  premium: boolean; // past the 200k cliff → long-context surcharge applied
};

// Pull every usage-bearing call out of one transcript's lines. project honors a
// sessions-meta override (the only way "Set project" can re-home a session —
// matches lib/sessions.ts `m.project || derived`); kind is a per-call origin
// tag, with the hook sentinel (detected anywhere in the session) winning.
function extractCalls(
  lines: string[],
  file: string,
  meta: SessionsMeta,
  cutoffMs: number
): Call[] {
  const id = path.basename(file, ".jsonl");
  const override = meta[id]?.project;
  let cwdProject = "";
  let sentinel = false;
  const raw: {
    at: string;
    output: number;
    rawTokens: number;
    weightedTokens: number;
    cost: number;
    premium: boolean;
    sidechain: boolean;
    entrypoint?: string;
  }[] = [];

  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwdProject && typeof e.cwd === "string")
      cwdProject = e.cwd === os.homedir() ? "Unassigned" : path.basename(e.cwd);
    if (!sentinel && e?.message?.role === "user") {
      const c = e.message.content;
      const text = typeof c === "string" ? c : JSON.stringify(c);
      if (text.includes(USAGE_PROBE_SENTINEL)) sentinel = true;
    }
    const u = e?.message?.usage;
    if (!u || !e.timestamp) continue;
    if (cutoffMs && new Date(e.timestamp).getTime() < cutoffMs) continue;
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
    raw.push({
      at: e.timestamp,
      output: t.output,
      rawTokens: t.input + t.cacheCreate + t.cacheRead + t.output,
      weightedTokens: weighted(t),
      cost: usd,
      premium,
      sidechain: e.isSidechain === true,
      entrypoint: typeof e.entrypoint === "string" ? e.entrypoint : undefined,
    });
  }

  const project = override || cwdProject;
  return raw.map((r) => {
    const kind: CallKind = sentinel
      ? "hook/usage"
      : r.sidechain
        ? "subagent"
        : r.entrypoint === "sdk-cli"
          ? "headless"
          : "interactive";
    return {
      at: r.at,
      project,
      kind,
      label: KIND_LABEL[kind],
      output: r.output,
      raw: r.rawTokens,
      weightedTokens: r.weightedTokens,
      cost: r.cost,
      premium: r.premium,
    };
  });
}

export function getCalls(limit = 25): Call[] {
  const meta = getSessionsMeta();
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
    calls.push(...extractCalls(lines, file, meta, 0));
  }
  return calls.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

// Every call from the last 7 days (rolling), uncapped. Scans every transcript
// touched in that window and reads it in full (the tail/file caps in getCalls
// would silently drop older calls), keeping calls timestamped within 7 days.
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function getRecentCalls(): Call[] {
  const cutoffMs = Date.now() - WINDOW_MS;
  const meta = getSessionsMeta();

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  const calls: Call[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const file = path.join(dirPath, f);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue; // vanished mid-scan
      }
      if (st.mtimeMs < cutoffMs) continue; // untouched in window → nothing in it
      let content;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      calls.push(...extractCalls(content.split("\n"), file, meta, cutoffMs));
    }
  }
  return calls.sort((a, b) => b.at.localeCompare(a.at));
}

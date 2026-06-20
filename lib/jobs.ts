import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// BACKGROUND / DISPATCHED AGENTS — the headless runs Claude Code launches into
// the background (the "&"-style dispatched daemon agents). Each gets a dir:
//
//   ~/.claude/jobs/<id>/state.json   ← {state, name, intent, sessionId, cwd, …}
//   ~/.claude/jobs/<id>/timeline.jsonl  (ignored in v1)
//
// state.json keys confirmed on disk: state ("running"|"blocked"|"done"|…),
// name, intent, needs/detail (the prompt-for-input text), sessionId,
// resumeSessionId, cwd, model? (sometimes only in respawnFlags), createdAt,
// updatedAt. We read it straight off disk — never shell out to `claude agents`.

const JOBS_DIR = path.join(os.homedir(), ".claude", "jobs");

export type BackgroundAgent = {
  id: string; // the jobs/<id> dir name
  name: string;
  state: string; // "running" | "blocked" | "done" | …
  detail: string; // the freshest human-readable status / question
  intent: string; // the originating ask
  sessionId: string;
  cwd: string;
  model: string; // best-effort (state.model or parsed from respawnFlags)
  updatedAt: number; // ms
  createdAt: number; // ms
};

type State = {
  state?: string;
  name?: string;
  detail?: string;
  needs?: string;
  intent?: string;
  sessionId?: string;
  resumeSessionId?: string;
  cwd?: string;
  model?: string;
  respawnFlags?: string[];
  createdAt?: string | number;
  updatedAt?: string | number;
};

function ms(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

// The model isn't always a top-level field; it's reliably in respawnFlags as the
// pair ["--model", "<name>"]. Pull it out as a fallback.
function modelFrom(s: State): string {
  if (s.model) return s.model;
  const flags = s.respawnFlags;
  if (Array.isArray(flags)) {
    const i = flags.indexOf("--model");
    if (i >= 0 && i + 1 < flags.length) return String(flags[i + 1]);
  }
  return "";
}

// All background agents, newest-updated first. Tolerates a missing jobs dir
// (older CLI / never dispatched one) → [].
export function backgroundAgents(): BackgroundAgent[] {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(JOBS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: BackgroundAgent[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const stateFile = path.join(JOBS_DIR, d.name, "state.json");
    let s: State;
    try {
      s = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      continue; // no state.json (e.g. a tmp dir) / partial write — skip
    }
    out.push({
      id: d.name,
      name: s.name || d.name,
      state: s.state || "unknown",
      detail: s.detail || s.needs || "",
      intent: s.intent || "",
      sessionId: s.sessionId || s.resumeSessionId || "",
      cwd: s.cwd || "",
      model: modelFrom(s),
      updatedAt: ms(s.updatedAt),
      createdAt: ms(s.createdAt),
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

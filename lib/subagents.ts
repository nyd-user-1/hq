import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// SUBAGENTS — the nested Agent-tool children Claude Code spawns inside an
// interactive session. They live on disk next to the parent transcript:
//
//   ~/.claude/projects/<projectSlug>/<parentSessionId>/subagents/
//       agent-<agentId>.jsonl        ← the child's full sidechain transcript
//       agent-<agentId>.meta.json    ← {agentType, description, toolUseId}
//
// The parent edge is over-determined: the containing dir name IS the parent
// session id, every line in the child jsonl carries that same sessionId +
// isSidechain:true + agentId, and the meta's toolUseId matches an Agent
// tool_use in the parent timeline. We use the cheapest signal (the dir name)
// and only stat/head the files — never fully parse the (often huge) jsonl.
//
// Subagents are NOT independently resumable; the UI deep-links a subagent row
// to its PARENT session in the terminal.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

// A subagent is "working" if its transcript was touched very recently — the
// same mtime-recency heuristic the rest of HQ leans on for live status when no
// authoritative process record exists (subagents have none of their own).
export const SUBAGENT_ACTIVE_MS = 90_000;

export type SubagentNode = {
  agentId: string;
  parentSessionId: string;
  agentType: string; // e.g. "Explore", "claude", "general-purpose"
  description: string; // the Agent tool's short task description
  toolUseId: string; // the parent Agent tool_use id (edge back to the timeline)
  startedAt: number; // ms — first ts in the jsonl, else file ctime
  lastActive: number; // ms — file mtime
  active: boolean; // mtime within SUBAGENT_ACTIVE_MS
  bytes: number; // transcript size on disk
  lines: number; // rough line count (newline scan of the head)
};

type Meta = { agentType?: string; description?: string; toolUseId?: string };

// Locate a session's transcript DIR (the dir that holds <id>.jsonl). Scanning
// PROJECTS_ROOT for the .jsonl is robust to which project slug owns it — the
// session id is a UUID, so at most one match. Returns null when not on disk.
function sessionTranscriptDir(sessionId: string): string | null {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, d.name);
    try {
      if (fs.existsSync(path.join(dirPath, `${sessionId}.jsonl`))) return dirPath;
    } catch {
      // unreadable dir — skip
    }
  }
  return null;
}

function readMeta(file: string): Meta {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Meta) : {};
  } catch {
    return {};
  }
}

// Cheap "first timestamp" + rough line count off the FRONT of the jsonl, so we
// never read a multi-hundred-KB transcript in full. The head reliably contains
// the opening user line (which carries the timestamp).
function headStats(file: string, ctimeMs: number): { startedAt: number; lines: number } {
  let startedAt = ctimeMs;
  let lines = 0;
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString("utf8", 0, read);
    for (let i = 0; i < head.length; i++) if (head[i] === "\n") lines++;
    const firstLine = head.slice(0, head.indexOf("\n") >= 0 ? head.indexOf("\n") : head.length);
    try {
      const obj = JSON.parse(firstLine);
      const ts = obj?.timestamp ?? obj?.ts;
      const t = typeof ts === "number" ? ts : ts ? Date.parse(ts) : NaN;
      if (!Number.isNaN(t)) startedAt = t;
    } catch {
      // partial / non-JSON head — keep the ctime fallback
    }
  } catch {
    // unreadable — fall through to defaults
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
  return { startedAt, lines };
}

// All subagents nested under a given interactive session, newest-active first.
// Returns [] for a session with no subagents/ dir (the common case).
export function subagentsFor(sessionId: string | null): SubagentNode[] {
  if (!sessionId) return [];
  const dir = sessionTranscriptDir(sessionId);
  if (!dir) return [];
  const subDir = path.join(dir, "subagents");
  let names: string[];
  try {
    names = fs.readdirSync(subDir);
  } catch {
    return []; // no subagents/ — fine
  }
  const now = Date.now();
  const out: SubagentNode[] = [];
  for (const f of names) {
    if (!f.startsWith("agent-") || !f.endsWith(".jsonl")) continue;
    const agentId = f.slice("agent-".length, -".jsonl".length);
    const jsonl = path.join(subDir, f);
    let st: fs.Stats;
    try {
      st = fs.statSync(jsonl);
    } catch {
      continue; // vanished mid-scan
    }
    const meta = readMeta(path.join(subDir, `agent-${agentId}.meta.json`));
    const { startedAt, lines } = headStats(jsonl, st.ctimeMs);
    out.push({
      agentId,
      parentSessionId: sessionId,
      agentType: meta.agentType || "agent",
      description: meta.description || "",
      toolUseId: meta.toolUseId || "",
      startedAt,
      lastActive: st.mtimeMs,
      active: now - st.mtimeMs < SUBAGENT_ACTIVE_MS,
      bytes: st.size,
      lines,
    });
  }
  return out.sort((a, b) => b.lastActive - a.lastActive);
}

// Cheap parent-session → subagent-count map, for badges in a session list. Only
// readdir's each subagents/ dir (no file reads), so it's safe to call per render
// over the whole projects tree.
export function subagentCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return counts;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const projDir = path.join(PROJECTS_ROOT, d.name);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // A session's nested dir is named for its session id and holds subagents/.
      if (!e.isDirectory()) continue;
      const subDir = path.join(projDir, e.name, "subagents");
      let n = 0;
      try {
        for (const f of fs.readdirSync(subDir)) {
          if (f.startsWith("agent-") && f.endsWith(".jsonl")) n++;
        }
      } catch {
        continue; // no subagents/ for this session
      }
      if (n > 0) counts.set(e.name, n);
    }
  }
  return counts;
}

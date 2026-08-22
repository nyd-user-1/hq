import fs from "node:fs";
import path from "node:path";
import { getArchiveSessions, retainedTranscriptText } from "./archive";
import type { ArchiveSession } from "./archive";
import { claudeHome } from "./config";

// Sweep-or-keep: HQ owns transcript lifecycle now.
//
// Claude Code used to prune ~/.claude/projects/**/*.jsonl on its own, at
// `cleanupPeriodDays` (default 30) — silently, with no say from the user. That
// setting is now pinned to 3650 in ~/.claude/settings.json, so nothing ages out
// behind your back. The 30-day mark instead becomes a PROMPT: these transcripts
// are old, sweep them or keep them.
//
// What sweeping actually costs: the raw .jsonl is deleted (tool results, images,
// per-turn timestamps, `claude --resume`), but the cleaned user+assistant text
// survives in HQ's FTS5 index, carried forward as retained=1 (see
// scripts/build-search-index.mjs). So a swept session stays searchable and
// readable in /search?openSession=… — it just can't be resumed. A session that
// is NOT in the index yet would be lost outright, so sweeping refuses those.

export const SWEEP_THRESHOLD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEEPS_FILE = path.join(claudeHome(), "hq", "sweep-keeps.json");
const PROJECTS_ROOT = path.join(claudeHome(), "projects");

export type SweepCandidate = ArchiveSession & {
  ageDays: number;
  /** text is in the FTS index → the sweep is non-destructive to search */
  indexed: boolean;
  file: string;
};

// ---- keeps (pinned past the threshold) -------------------------------------

export function keptIds(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(KEEPS_FILE, "utf8"));
    return new Set(Array.isArray(raw?.ids) ? (raw.ids as string[]) : []);
  } catch {
    return new Set(); // no file yet / unreadable → nothing kept
  }
}

function writeKeeps(ids: Set<string>): void {
  fs.mkdirSync(path.dirname(KEEPS_FILE), { recursive: true });
  const tmp = `${KEEPS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ids: [...ids] }, null, 2));
  fs.renameSync(tmp, KEEPS_FILE); // atomic — a torn keeps file would re-expose swept ids
}

export function keepSessions(ids: string[]): number {
  const cur = keptIds();
  for (const id of ids) cur.add(id);
  writeKeeps(cur);
  return ids.length;
}

export function unkeepSessions(ids: string[]): number {
  const cur = keptIds();
  for (const id of ids) cur.delete(id);
  writeKeeps(cur);
  return ids.length;
}

// ---- candidates ------------------------------------------------------------

// id → transcript path. Sessions live at ~/.claude/projects/<cwd-slug>/<id>.jsonl;
// we scan rather than trust a slug, because the same id can only appear once.
function fileForId(id: string): string | null {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null; // no traversal via a crafted id
  let dirs: string[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const p = path.join(PROJECTS_ROOT, d, `${id}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Transcripts past the threshold that haven't been kept. Live/active sessions
 * are never candidates — you don't get asked to sweep something still running.
 */
export function sweepCandidates(thresholdDays = SWEEP_THRESHOLD_DAYS): SweepCandidate[] {
  const keeps = keptIds();
  const cutoff = Date.now() - thresholdDays * DAY_MS;
  const out: SweepCandidate[] = [];
  for (const s of getArchiveSessions()) {
    if (s.lastActive > cutoff) continue;
    if (keeps.has(s.id) || s.live || s.active) continue;
    const file = fileForId(s.id);
    if (!file) continue; // already swept — the retained text is all that's left
    out.push({
      ...s,
      file,
      ageDays: Math.floor((Date.now() - s.lastActive) / DAY_MS),
      indexed: retainedTranscriptText(s.id) !== null,
    });
  }
  out.sort((a, b) => a.lastActive - b.lastActive); // oldest first
  return out;
}

export function sweepCount(): number {
  return sweepCandidates().length;
}

// ---- the sweep itself ------------------------------------------------------

export type SweepResult = {
  swept: string[];
  skipped: { id: string; reason: string }[];
  freedBytes: number;
};

/**
 * Delete the raw .jsonl for each id. Refuses any session whose text isn't in
 * the search index yet — that one deletion would be unrecoverable, and waiting
 * for the next index build costs nothing.
 */
export function sweepSessions(ids: string[]): SweepResult {
  const res: SweepResult = { swept: [], skipped: [], freedBytes: 0 };
  const keeps = keptIds();
  for (const id of ids) {
    if (keeps.has(id)) {
      res.skipped.push({ id, reason: "kept" });
      continue;
    }
    const file = fileForId(id);
    if (!file) {
      res.skipped.push({ id, reason: "already gone" });
      continue;
    }
    if (retainedTranscriptText(id) === null) {
      // The index is the ONLY thing that survives a sweep. No index row → no.
      res.skipped.push({ id, reason: "not indexed yet — text would be lost" });
      continue;
    }
    try {
      const size = fs.statSync(file).size;
      fs.unlinkSync(file);
      res.swept.push(id);
      res.freedBytes += size;
    } catch {
      res.skipped.push({ id, reason: "delete failed" });
    }
  }
  return res;
}

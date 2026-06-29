import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// "Stopped from hq" sidecar. A hq stop SIGTERMs a turn mid-flight, so Claude Code
// never writes a closing `result` — the transcript then reads "working" forever and
// the box stays locked on reload. hq is the READER of transcripts (never a writer),
// so we record the stop here instead, as a tiny ~/.claude/hq/stops.json map of
// sessionId → stop timestamp. The turns reader treats a stop newer than the last
// transcript write as "this turn is done (interrupted)"; a later real write makes
// the marker stale automatically, so it self-clears on the next send.
const DIR = join(homedir(), ".claude", "hq");
const FILE = join(DIR, "stops.json");

function read(): Record<string, number> {
  try {
    const m = JSON.parse(readFileSync(FILE, "utf8"));
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}

// Record that this session's turn was stopped from hq, now.
export function markStopped(sessionId: string): void {
  if (!sessionId) return;
  try {
    mkdirSync(DIR, { recursive: true });
    const map = read();
    map[sessionId] = Date.now();
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(map));
    renameSync(tmp, FILE); // atomic swap
  } catch {
    /* best-effort — a missed marker just means the old "reads working" behavior */
  }
}

// When (ms epoch) this session was last stopped from hq, or 0 if never.
export function stoppedAt(sessionId: string): number {
  return read()[sessionId] ?? 0;
}

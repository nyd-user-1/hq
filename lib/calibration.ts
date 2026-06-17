import fs from "node:fs";
import path from "node:path";
import { contextSamples } from "./usage";

// Calibration — turns the planner's assumed constants into MEASURED ones, read
// from real telemetry and the actual repo on disk. This is the answer to "100k
// is a placeholder": cold context comes from transcript cache-creation events,
// per-file context from real file sizes. Both degrade gracefully (a flagged
// placeholder) when there isn't enough data yet.

const CWD = process.cwd();

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const i = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round(((p / 100) * (sortedAsc.length - 1))))
  );
  return sortedAsc[i];
}

export type ColdContext = { p50: number; p90: number; measured: boolean };

// Cold-context size, calibrated from real transcript cache-creation events (the
// tokens written to cache when a session first loads its prefix). Always a
// p50/p90 RANGE, never a point — and it flags when it fell back to a placeholder
// for want of data, so the UI can say so out loud.
export function coldContext(): ColdContext {
  const creates = contextSamples()
    .map((s) => s.create)
    .filter((n) => n > 2000) // ignore tiny/no-cache turns — real prefix writes only
    .sort((a, b) => a - b);
  if (creates.length < 5) {
    return { p50: 25_000, p90: 45_000, measured: false }; // placeholder until data
  }
  return {
    p50: percentile(creates, 50),
    p90: percentile(creates, 90),
    measured: true,
  };
}

const fileTokenCache = new Map<string, number>();
const NEW_FILE_TOKENS = 1200; // a `writes` target that doesn't exist yet

// Size-weighted context tokens for a file path (≈ bytes / 4). Resolved against
// the repo root and cached. A non-existent path (a not-yet-created file) returns
// a small fixed estimate. This is what makes the cache discount a function of
// real file overlap weighted by size — not a flat per-batch number.
export function fileTokens(p: string): number {
  const cached = fileTokenCache.get(p);
  if (cached !== undefined) return cached;
  let tokens = NEW_FILE_TOKENS;
  try {
    const full = path.isAbsolute(p) ? p : path.join(CWD, p);
    tokens = Math.max(1, Math.round(fs.statSync(full).size / 4));
  } catch {
    /* missing → treat as a new-file target, keep the estimate */
  }
  fileTokenCache.set(p, tokens);
  return tokens;
}

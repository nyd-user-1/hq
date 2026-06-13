import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { callCost } from "./pricing";

// Token meter over Claude Code's local transcripts (~/.claude/projects/**/*.jsonl).
// Same source the /usage screen aggregates: every assistant message logs a
// `usage` block.
//
// TWO corrections over the naive "sum every line with usage" approach:
//  1. DEDUPE by requestId. Claude Code writes a message's usage block ~3x
//     (streaming partials), so summing every line triple-counts. We keep one
//     record per requestId (last-wins = the final streamed totals).
//  2. PER-MODEL weighting. A token on Opus costs the rate limit far more than
//     one on Sonnet/Haiku. We scale each entry by a model tier multiplier so a
//     shifting model mix tracks the real /usage % instead of drifting.
// Files are append-only, so each is cached by byte offset and only new bytes
// are parsed after the first load.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

export type Totals = {
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  messages: number;
};

const zero = (): Totals => ({
  input: 0,
  cacheCreate: 0,
  cacheRead: 0,
  output: 0,
  messages: 0,
});

// Within-model token shape, standard Anthropic price ratios:
// fresh input ×1, cache write ×1.25, cache read ×0.1, output ×5.
function shape(input: number, cw: number, cr: number, out: number): number {
  return input + 1.25 * cw + 0.1 * cr + 5 * out;
}

// Backward-compatible model-agnostic weight over a Totals block.
export function weighted(t: Totals): number {
  return shape(t.input, t.cacheCreate, t.cacheRead, t.output);
}

// Per-model multiplier relative to Sonnet = 1.0 — a price-tier proxy for how
// fast each model burns the rate limit. CALIBRATION KNOB: tune as /usage
// readings across different model mixes accumulate. (Fable/Mythos priced as a
// premium tier ≥ Opus; placeholder until a Fable-heavy block is measured.)
const MODEL_WEIGHT: Array<[string, number]> = [
  ["opus", 5.0],
  ["sonnet", 1.0],
  ["haiku", 0.33],
  ["fable", 5.0],
  ["mythos", 5.0],
];
function modelWeight(model?: string): number {
  if (!model) return 1.0;
  const m = model.toLowerCase();
  for (const [key, w] of MODEL_WEIGHT) if (m.includes(key)) return w;
  return 1.0;
}

// One deduped record per requestId.
type Rec = {
  ts: number;
  model?: string;
  input: number;
  cw: number;
  cr: number;
  out: number;
};
type FileCache = { offset: number; recs: Map<string, Rec> };

const fileCache = new Map<string, FileCache>();

function parseNewLines(file: string, cache: FileCache): void {
  const size = fs.statSync(file).size;
  if (size < cache.offset) {
    cache.offset = 0;
    cache.recs = new Map();
  }
  if (size === cache.offset) return;

  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - cache.offset);
  fs.readSync(fd, buf, 0, buf.length, cache.offset);
  fs.closeSync(fd);

  const text = buf.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) return;
  cache.offset += Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");

  for (const line of text.slice(0, lastNewline).split("\n")) {
    if (!line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    const t = Date.parse(entry?.timestamp);
    if (!usage || Number.isNaN(t)) continue;
    // dedupe key: requestId, else message.id, else a per-file unique fallback
    const id: string =
      entry?.requestId ?? entry?.message?.id ?? `_n${cache.recs.size}`;
    cache.recs.set(id, {
      ts: t,
      model: entry?.message?.model,
      input: usage.input_tokens ?? 0,
      cw: usage.cache_creation_input_tokens ?? 0,
      cr: usage.cache_read_input_tokens ?? 0,
      out: usage.output_tokens ?? 0,
    });
  }
}

function transcriptFiles(maxAgeMs: number): string[] {
  const cutoff = Date.now() - maxAgeMs;
  const files: string[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return []; // no ~/.claude here (e.g. deployed) — meter renders empty
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        if (fs.statSync(full).mtimeMs >= cutoff) files.push(full);
      } catch {
        // file vanished mid-scan
      }
    }
  }
  return files;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function refreshCache(): void {
  for (const file of transcriptFiles(WEEK_MS)) {
    let cache = fileCache.get(file);
    if (!cache) {
      cache = { offset: 0, recs: new Map() };
      fileCache.set(file, cache);
    }
    try {
      parseNewLines(file, cache);
    } catch {
      // unreadable — skip
    }
  }
}

function* allRecs(): Generator<Rec> {
  for (const { recs } of fileCache.values()) {
    for (const r of recs.values()) yield r;
  }
}

// Limits in weighted tokens, recalibrated 2026-06-11 ~6:32pm AFTER dedupe +
// per-model weighting, anchored to the real /usage screen (session 23%, week
// 43%). The pre-dedupe limits (18.3M / 2.15B) were fit to ~3.3x inflated,
// model-agnostic numbers; these replace them. Recalibrate when /usage disagrees.
export const SESSION_LIMIT_WEIGHTED = 212_000_000;
export const WEEK_LIMIT_WEIGHTED = 4_300_000_000;

const BLOCK_MS = 5 * 60 * 60 * 1000;

// Session limits run in 5h blocks anchored so one resets at 5am local
// (machine TZ = America/New_York, same clock /usage displays).
export function sessionBlock(): { start: number; reset: number } {
  const anchor = new Date();
  anchor.setHours(5, 0, 0, 0);
  const diff = Date.now() - anchor.getTime();
  const start = anchor.getTime() + Math.floor(diff / BLOCK_MS) * BLOCK_MS;
  return { start, reset: start + BLOCK_MS };
}

export type Spend = {
  session: number; // USD this 5h session block
  today: number; // USD since local midnight
  week: number; // USD trailing 7 days
  generatedAt: number;
};

// Estimated USD spend over the live session block, today (local), and the
// trailing week — summed over the SAME deduped per-call records the token meter
// uses, priced via lib/pricing. Estimates; see pricing.ts header.
export function getSpend(): Spend {
  refreshCache();
  const now = Date.now();
  const sessStart = sessionBlock().start;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const todayStart = day.getTime();
  const weekStart = now - WEEK_MS;
  let session = 0;
  let today = 0;
  let week = 0;
  for (const r of allRecs()) {
    if (r.ts < weekStart) continue;
    const { usd } = callCost({
      model: r.model,
      input: r.input,
      cacheCreate: r.cw,
      cacheRead: r.cr,
      output: r.out,
    });
    week += usd;
    if (r.ts >= todayStart) today += usd;
    if (r.ts >= sessStart) session += usd;
  }
  return { session, today, week, generatedAt: now };
}

export type Window = {
  label: string;
  since: number;
  totals: Totals;
  weightedTotal: number;
  limit?: number;
};

export function getUsage(): { windows: Window[]; generatedAt: number } {
  refreshCache();
  const now = Date.now();

  const block = sessionBlock();
  const resetLabel = new Date(block.reset)
    .toLocaleTimeString("en-US", { hour: "numeric" })
    .replace(" ", "");
  const windows: Window[] = [
    {
      label: `Session Reset: ${resetLabel}`,
      since: block.start,
      totals: zero(),
      weightedTotal: 0,
      limit: SESSION_LIMIT_WEIGHTED,
    },
    {
      label: "Last 24h",
      since: now - 24 * 60 * 60 * 1000,
      totals: zero(),
      weightedTotal: 0,
    },
    {
      label: "Week (last 7d)",
      since: now - WEEK_MS,
      totals: zero(),
      weightedTotal: 0,
      limit: WEEK_LIMIT_WEIGHTED,
    },
  ];

  for (const r of allRecs()) {
    if (now - r.ts > WEEK_MS) continue;
    const ew = shape(r.input, r.cw, r.cr, r.out) * modelWeight(r.model);
    for (const w of windows) {
      if (r.ts >= w.since) {
        w.totals.input += r.input;
        w.totals.cacheCreate += r.cw;
        w.totals.cacheRead += r.cr;
        w.totals.output += r.out;
        w.totals.messages += 1;
        w.weightedTotal += ew;
      }
    }
  }

  return { windows, generatedAt: now };
}

// Per-transcript deduped lifetime totals from the file cache (call getUsage()
// or getForecast() first to warm it). Consumed by lib/sessions.ts.
export function perFileTotals(): Map<string, Totals> {
  const m = new Map<string, Totals>();
  for (const [file, { recs }] of fileCache) {
    const sum = zero();
    for (const r of recs.values()) {
      sum.input += r.input;
      sum.cacheCreate += r.cw;
      sum.cacheRead += r.cr;
      sum.output += r.out;
      sum.messages += 1;
    }
    m.set(file, sum);
  }
  return m;
}

export type Forecast = {
  burnPerMin: number; // weighted tokens/min over a trailing window
  blockWeighted: number; // weighted used in the current session block
  limit: number;
  blockReset: number;
  projectedCapAt: number | null; // ms; null = won't hit cap before the reset
  underCap: boolean;
};

const TRAIL_MS = 15 * 60 * 1000; // trailing window for the burn rate

// Forward-looking companion to getUsage(): a burn-rate forecast. Stock vs flow
// — getUsage answers "how much of the cap is used", this answers "at the
// current rate, when do we hit it".
export function getForecast(): Forecast {
  refreshCache();
  const now = Date.now();
  const block = sessionBlock();
  let blockWeighted = 0;
  let trailWeighted = 0;
  for (const r of allRecs()) {
    const ew = shape(r.input, r.cw, r.cr, r.out) * modelWeight(r.model);
    if (r.ts >= block.start) blockWeighted += ew;
    if (now - r.ts <= TRAIL_MS) trailWeighted += ew;
  }
  const burnPerMin = trailWeighted / (TRAIL_MS / 60000);
  const remaining = Math.max(SESSION_LIMIT_WEIGHTED - blockWeighted, 0);
  const minsToCap = burnPerMin > 0 ? remaining / burnPerMin : Infinity;
  const capTime = now + minsToCap * 60000;
  const projectedCapAt =
    Number.isFinite(minsToCap) && capTime < block.reset ? capTime : null;
  return {
    burnPerMin,
    blockWeighted,
    limit: SESSION_LIMIT_WEIGHTED,
    blockReset: block.reset,
    projectedCapAt,
    underCap: projectedCapAt === null,
  };
}

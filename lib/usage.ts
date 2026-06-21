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
export function modelWeight(model?: string): number {
  if (!model) return 1.0;
  const m = model.toLowerCase();
  for (const [key, w] of MODEL_WEIGHT) if (m.includes(key)) return w;
  return 1.0;
}

// Display-tier label for the same model families — the human bucket the /usage
// screen groups by ("Current week (Opus)", the model-mix breakdown).
const TIER_LABEL: Array<[string, string]> = [
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku"],
  ["fable", "Fable"],
  ["mythos", "Mythos"],
];
export function modelTier(model?: string): string {
  if (!model) return "Other";
  const m = model.toLowerCase();
  for (const [key, label] of TIER_LABEL) if (m.includes(key)) return label;
  return "Other";
}

// One deduped record per requestId.
type Rec = {
  ts: number;
  model?: string;
  input: number;
  cw: number;
  cr: number;
  out: number;
  sidechain: boolean; // a subagent turn (isSidechain) — for the /usage breakdown
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
      sidechain: entry?.isSidechain === true,
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

// The plan's SEPARATE, lower weekly Opus cap (/usage shows it as "Current week
// (Opus)"). The real ceiling lives in the API rate-limit headers, which never
// reach disk — so this is an UNCALIBRATED placeholder. It defaults to the
// all-models weekly cap (⇒ the Opus meter under-reports vs the true sub-cap);
// drop it to the real number the moment /usage shows the Opus %. The Opus meter
// carries calibrated:false so the panel flags it as an estimate.
export const WEEK_OPUS_LIMIT_WEIGHTED = 4_300_000_000;

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

// Per-turn context samples for calibration: each deduped record's total context
// (input + cache write + cache read) and its cache-creation (the cold-prefix
// write). The batch planner derives a measured cold-context range from these
// instead of assuming a constant. Refreshes the cache first.
export function contextSamples(): { ctx: number; create: number }[] {
  refreshCache();
  const out: { ctx: number; create: number }[] = [];
  for (const r of allRecs()) out.push({ ctx: r.input + r.cw + r.cr, create: r.cw });
  return out;
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

// ── /usage states ─────────────────────────────────────────────────────────
// One composite payload mirroring the CLI's `/usage` screen, modeled entirely
// from local transcripts. The live screen reads the API rate-limit HEADERS
// (5h/weekly windows, reset clocks, overage) which are consumed in-process and
// never written to disk — so HQ can't read the true values. What it CAN do is
// what lib/usage already does: a calibrated estimate of each window. This bundles
// every state the panel surfaces so the API route is a single read.

export type MeterState = "ok" | "approaching" | "reached";

// A /usage meter row: a capped % bar against a (modeled) limit, its rolling or
// block reset, and the ok/approaching/reached state the CLI colors it by.
export type UsageMeter = {
  key: "session" | "weekAll" | "weekOpus";
  label: string;
  span: string; // "5h block" / "trailing 7d"
  usedWeighted: number;
  rawTokens: number;
  messages: number;
  limit: number;
  pct: number; // 0..100, capped for the bar
  rawPct: number; // uncapped — > 100 once a modeled cap is blown
  resetsAt: number | null; // ms; null = rolling window (no fixed reset on disk)
  state: MeterState;
  calibrated: boolean; // false ⇒ limit is an uncalibrated estimate (Opus week)
  source: "live" | "modeled"; // live = real %/reset from a fresh hook snapshot
};

export type ModelShare = { tier: string; weighted: number; pct: number };
export type UsageInsight = { key: string; label: string; pct: number };

export type UsageStates = {
  meters: UsageMeter[];
  forecast: Forecast;
  spend: Spend;
  byModel: ModelShare[]; // weighted model mix over the week (the /usage breakdown)
  insights: UsageInsight[]; // long-context + subagent shares of weekly usage
  snapshotAt: number | null; // ms a fresh live snapshot was captured; null = all modeled
  generatedAt: number;
};

// ── live snapshot ───────────────────────────────────────────────────────────
// The SessionStart usage-capture hook harvests the REAL /usage windows (which
// never otherwise hit disk) into this sidecar. When one is fresh we overlay its
// true utilization/reset/status onto the modeled meters; otherwise the model
// stands alone. See scripts/hooks/usage-capture.mjs.
const SNAPSHOT = path.join(os.homedir(), ".claude", "hq", "usage-snapshot.json");
const LIVE_TTL_MS = 2 * 60 * 60 * 1000; // older than this ⇒ fall back to the model

type SnapWindow = { utilization?: number; resetsAt?: number; status?: string };
type Snapshot = { capturedAt: number; windows: Record<string, SnapWindow> };

function readSnapshot(): Snapshot | null {
  try {
    const s = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    if (s && typeof s.capturedAt === "number" && s.windows) return s as Snapshot;
  } catch {
    /* no snapshot — modeled only */
  }
  return null;
}

// The statusline shim (the tee added to ~/.claude/statusline-command.sh) writes
// Claude Code's full status JSON here every assistant message. It carries the
// REAL rate-limit windows (five_hour / seven_day) + session cost that never
// otherwise reach disk — fresher AND free vs the paid SessionStart probe above.
// We read the raw CC schema and map it to the same window shape; freshness is
// the file's mtime (the raw JSON has no timestamp of its own).
const STATUSLINE_SNAP = path.join(os.homedir(), ".claude", "hq", "statusline-snapshot.json");

function readStatuslineSnapshot(): Snapshot | null {
  let raw: unknown;
  let mtime: number;
  try {
    raw = JSON.parse(fs.readFileSync(STATUSLINE_SNAP, "utf8"));
    mtime = fs.statSync(STATUSLINE_SNAP).mtimeMs;
  } catch {
    return null; // shim not wired / not written yet
  }
  const rl = (raw as { rate_limits?: Record<string, { used_percentage?: number; resets_at?: number }> })
    ?.rate_limits;
  if (!rl) return null; // rate_limits absent (pre-first-response / not a subscriber)
  const windows: Record<string, SnapWindow> = {};
  const pairs: Array<[string, { used_percentage?: number; resets_at?: number } | undefined]> = [
    ["five_hour", rl.five_hour],
    ["seven_day", rl.seven_day],
  ];
  for (const [key, w] of pairs) {
    if (w && typeof w.used_percentage === "number")
      windows[key] = {
        utilization: w.used_percentage / 100,
        resetsAt: typeof w.resets_at === "number" ? w.resets_at * 1000 : undefined,
      };
  }
  return Object.keys(windows).length ? { capturedAt: mtime, windows } : null;
}

// Merge the live sources, newest-wins PER WINDOW: statusline first (fresher,
// free) for five_hour/seven_day, the probe fills what only it has (seven_day_opus).
// Only windows within the TTL contribute, so a stale source never overwrites a
// fresh one.
function mergeLiveSnapshots(now: number): Snapshot | null {
  const windows: Record<string, SnapWindow> = {};
  let capturedAt = 0;
  for (const s of [readStatuslineSnapshot(), readSnapshot()]) {
    if (!s || now - s.capturedAt >= LIVE_TTL_MS) continue;
    for (const [k, w] of Object.entries(s.windows)) if (!(k in windows)) windows[k] = w;
    if (s.capturedAt > capturedAt) capturedAt = s.capturedAt;
  }
  return Object.keys(windows).length ? { capturedAt, windows } : null;
}

// /usage `status` enum → the meter state machine.
const STATUS_STATE: Record<string, MeterState> = {
  allowed: "ok",
  allowed_warning: "approaching",
  rejected: "reached",
};
// meter.key → the rateLimitType the hook records it under.
const LIVE_KEY: Record<UsageMeter["key"], string> = {
  session: "five_hour",
  weekAll: "seven_day",
  weekOpus: "seven_day_opus",
};

// CLI /usage flips a meter to "Approaching" near the cap; mirror that at 80%.
const APPROACHING_PCT = 80;
function meterState(rawPct: number): MeterState {
  if (rawPct >= 100) return "reached";
  if (rawPct >= APPROACHING_PCT) return "approaching";
  return "ok";
}

export function getUsageStates(): UsageStates {
  refreshCache();
  const now = Date.now();
  const block = sessionBlock();
  const weekStart = now - WEEK_MS;

  let sessW = 0,
    sessRaw = 0,
    sessMsg = 0;
  let weekW = 0,
    weekRaw = 0,
    weekMsg = 0;
  let opusW = 0,
    opusRaw = 0,
    opusMsg = 0;
  let long150 = 0, // weighted at >150k context
    long100 = 0, // weighted on >100k-token turns
    subW = 0; // weighted from subagent (sidechain) turns
  const modelW = new Map<string, number>();

  for (const r of allRecs()) {
    if (r.ts < weekStart) continue;
    const raw = r.input + r.cw + r.cr + r.out;
    const ew = shape(r.input, r.cw, r.cr, r.out) * modelWeight(r.model);
    const ctx = r.input + r.cw + r.cr;
    const tier = modelTier(r.model);

    weekW += ew;
    weekRaw += raw;
    weekMsg += 1;
    modelW.set(tier, (modelW.get(tier) ?? 0) + ew);
    if (ctx > 150_000) long150 += ew;
    if (r.input + r.cw + r.cr + r.out > 100_000) long100 += ew;
    if (r.sidechain) subW += ew;
    if (tier === "Opus") {
      opusW += ew;
      opusRaw += raw;
      opusMsg += 1;
    }
    if (r.ts >= block.start) {
      sessW += ew;
      sessRaw += raw;
      sessMsg += 1;
    }
  }

  const sessPct = (sessW / SESSION_LIMIT_WEIGHTED) * 100;
  const weekPct = (weekW / WEEK_LIMIT_WEIGHTED) * 100;
  const opusPct = (opusW / WEEK_OPUS_LIMIT_WEIGHTED) * 100;

  const meters: UsageMeter[] = [
    {
      key: "session",
      label: "Current session",
      span: "5h block",
      usedWeighted: sessW,
      rawTokens: sessRaw,
      messages: sessMsg,
      limit: SESSION_LIMIT_WEIGHTED,
      pct: Math.min(sessPct, 100),
      rawPct: sessPct,
      resetsAt: block.reset,
      state: meterState(sessPct),
      calibrated: true,
      source: "modeled",
    },
    {
      key: "weekAll",
      label: "Current week · all models",
      span: "trailing 7d",
      usedWeighted: weekW,
      rawTokens: weekRaw,
      messages: weekMsg,
      limit: WEEK_LIMIT_WEIGHTED,
      pct: Math.min(weekPct, 100),
      rawPct: weekPct,
      resetsAt: null,
      state: meterState(weekPct),
      calibrated: true,
      source: "modeled",
    },
    {
      key: "weekOpus",
      label: "Current week · Opus",
      span: "trailing 7d",
      usedWeighted: opusW,
      rawTokens: opusRaw,
      messages: opusMsg,
      limit: WEEK_OPUS_LIMIT_WEIGHTED,
      pct: Math.min(opusPct, 100),
      rawPct: opusPct,
      resetsAt: null,
      state: meterState(opusPct),
      calibrated: false,
      source: "modeled",
    },
  ];

  // Overlay the real values, newest-source-wins per window: the statusline shim
  // (free, every assistant message) for five_hour/seven_day, the SessionStart
  // probe for what only it captures (seven_day_opus).
  const liveFresh = mergeLiveSnapshots(now);
  if (liveFresh) {
    for (const m of meters) {
      const w = liveFresh.windows[LIVE_KEY[m.key]];
      if (!w || typeof w.utilization !== "number") continue;
      m.source = "live";
      m.rawPct = w.utilization * 100;
      m.pct = Math.min(m.rawPct, 100);
      if (typeof w.resetsAt === "number") m.resetsAt = w.resetsAt;
      m.state = (w.status && STATUS_STATE[w.status]) || meterState(m.rawPct);
      if (m.key === "weekOpus") m.calibrated = true; // live ⇒ the real cap, not an estimate
    }
  }

  const byModel: ModelShare[] = [...modelW.entries()]
    .map(([tier, weighted]) => ({
      tier,
      weighted,
      pct: weekW ? (weighted / weekW) * 100 : 0,
    }))
    .sort((a, b) => b.weighted - a.weighted);

  const insights: UsageInsight[] = [
    { key: "long150", label: "at >150k context", pct: weekW ? (long150 / weekW) * 100 : 0 },
    { key: "long100", label: "on >100k-token turns", pct: weekW ? (long100 / weekW) * 100 : 0 },
    { key: "subagent", label: "from subagents", pct: weekW ? (subW / weekW) * 100 : 0 },
  ];

  return {
    meters,
    forecast: getForecast(),
    spend: getSpend(),
    byModel,
    insights,
    snapshotAt: liveFresh ? liveFresh.capturedAt : null,
    generatedAt: now,
  };
}

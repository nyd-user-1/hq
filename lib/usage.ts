import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Token meter over Claude Code's local transcripts (~/.claude/projects/**/*.jsonl).
// Same source the /usage screen aggregates: every assistant message logs a
// `usage` block. Files are append-only, so each file is cached by byte offset
// and only new bytes are parsed after the first load.

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const BUCKET_MS = 10 * 60 * 1000; // 10-minute buckets

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

type FileCache = {
  offset: number;
  buckets: Map<number, Totals>;
};

const fileCache = new Map<string, FileCache>();

function parseNewLines(file: string, cache: FileCache): void {
  const size = fs.statSync(file).size;
  if (size < cache.offset) {
    // truncated/rewritten — start over
    cache.offset = 0;
    cache.buckets = new Map();
  }
  if (size === cache.offset) return;

  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(size - cache.offset);
  fs.readSync(fd, buf, 0, buf.length, cache.offset);
  fs.closeSync(fd);

  const text = buf.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) return; // no complete line yet
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
    const bucketKey = Math.floor(t / BUCKET_MS);
    let b = cache.buckets.get(bucketKey);
    if (!b) {
      b = zero();
      cache.buckets.set(bucketKey, b);
    }
    b.input += usage.input_tokens ?? 0;
    b.cacheCreate += usage.cache_creation_input_tokens ?? 0;
    b.cacheRead += usage.cache_read_input_tokens ?? 0;
    b.output += usage.output_tokens ?? 0;
    b.messages += 1;
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

// Limits in weighted tokens, calibrated against the real /usage screen
// 2026-06-11 ~2:51am: the session block (since midnight) stood at ~15.8M
// weighted when /usage read 83% ⇒ limit ≈19.1M; week read 35% at ~751M
// ⇒ ≈2.15B. A marginal 73%→83% calibration disagreed — some transcript
// usage (e.g. background Haiku) apparently doesn't count toward limits —
// so the block-total anchor wins. Recalibrate when /usage disagrees.
// Second observation 3:31am: meter read 94% (17.95M) when /usage flashed
// 96% ⇒ limit ≈18.7M. Third, ~3:45am: meter 98% (18.33M) at real 100%
// ⇒ ≈18.3M. Error is converging ~1-2pts low per reading — the meter may
// lag real accounting slightly; bias the limit down.
export const SESSION_LIMIT_WEIGHTED = 18_300_000;
export const WEEK_LIMIT_WEIGHTED = 2_150_000_000;

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

export type Window = {
  label: string;
  since: number;
  totals: Totals;
  limit?: number;
};

export function getUsage(): { windows: Window[]; generatedAt: number } {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (const file of transcriptFiles(weekMs + BUCKET_MS)) {
    let cache = fileCache.get(file);
    if (!cache) {
      cache = { offset: 0, buckets: new Map() };
      fileCache.set(file, cache);
    }
    try {
      parseNewLines(file, cache);
    } catch {
      // unreadable file — skip
    }
  }

  const block = sessionBlock();
  const resetLabel = new Date(block.reset)
    .toLocaleTimeString("en-US", { hour: "numeric" })
    .replace(" ", "");
  const windows: Window[] = [
    {
      label: `Session Reset: ${resetLabel}`,
      since: block.start,
      totals: zero(),
      limit: SESSION_LIMIT_WEIGHTED,
    },
    { label: "Last 24h", since: now - 24 * 60 * 60 * 1000, totals: zero() },
    {
      label: "Week (last 7d)",
      since: now - weekMs,
      totals: zero(),
      limit: WEEK_LIMIT_WEIGHTED,
    },
  ];

  for (const { buckets } of fileCache.values()) {
    for (const [bucketKey, b] of buckets) {
      const bucketTime = bucketKey * BUCKET_MS;
      if (now - bucketTime > weekMs) continue;
      for (const w of windows) {
        if (bucketTime >= w.since) {
          w.totals.input += b.input;
          w.totals.cacheCreate += b.cacheCreate;
          w.totals.cacheRead += b.cacheRead;
          w.totals.output += b.output;
          w.totals.messages += b.messages;
        }
      }
    }
  }

  return { windows, generatedAt: now };
}

// Per-transcript lifetime totals from the file cache (call getUsage() first).
export function perFileTotals(): Map<string, Totals> {
  const m = new Map<string, Totals>();
  for (const [file, { buckets }] of fileCache) {
    const sum = zero();
    for (const b of buckets.values()) {
      sum.input += b.input;
      sum.cacheCreate += b.cacheCreate;
      sum.cacheRead += b.cacheRead;
      sum.output += b.output;
      sum.messages += b.messages;
    }
    m.set(file, sum);
  }
  return m;
}

// Cost-proxy in input-token equivalents, standard Anthropic price ratios:
// fresh input ×1, cache write ×1.25, cache read ×0.1, output ×5.
export function weighted(t: Totals): number {
  return t.input + 1.25 * t.cacheCreate + 0.1 * t.cacheRead + 5 * t.output;
}

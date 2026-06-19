import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { weighted, modelTier } from "./usage";
import { callCost } from "./pricing";
import { getSessionsMeta, type SessionsMeta } from "./sessions-meta";

// The Calls ledger spans ALL transcripts (not a rolling 7d window), made cheap by
// the same byte-offset incremental parse the token meter uses (lib/usage.ts): each
// file is read once, then only newly-appended bytes are parsed on later opens. The
// parsed state is persisted to a sidecar so the one-time full build (~11s over
// ~1.9GB / 33k calls) is paid ONCE EVER, not on every server restart. Records are
// DEDUPED by requestId (last-wins = final streamed totals) so streaming partials
// count once — the ledger shows real API round-trips and its $ totals line up with
// the meter (which dedupes the same way).
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const SIDECAR = path.join(HQ_DIR, "calls-index.json");
const SIDECAR_VERSION = 1;

// The HQ usage-capture hook stamps this on its probe's user turn so those throwaway
// calls read as "hook · usage" in the ledger. Keep in sync with the hook script.
export const USAGE_PROBE_SENTINEL = "hq-usage-probe";

// What a call was FOR, inferred from transcript signals: entrypoint (cli vs sdk-cli
// = headless/HQ-driven), isSidechain (a subagent turn), and the probe sentinel.
export type CallKind = "interactive" | "headless" | "subagent" | "hook/usage";

export type Call = {
  id: string; // requestId (stable) — the drill-down key
  at: string;
  session: string; // full session id (the transcript filename); UI shows first 8
  project: string;
  kind: CallKind;
  model: string; // tier label: opus | sonnet | haiku | fable | mythos | other
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
  raw: number;
  weightedTokens: number;
  cost: number; // estimated USD for this call
  premium: boolean; // past the 200k cliff → long-context surcharge applied
};

// ── incremental, persisted cache ─────────────────────────────────────────────
type CallRec = {
  id: string; // requestId (dedupe key) — kept so the sidecar can rebuild the map
  ts: number;
  at: string;
  model?: string;
  input: number;
  cw: number;
  cr: number;
  out: number;
  sidechain: boolean;
  entrypoint?: string;
};
type FileCache = {
  offset: number; // bytes parsed so far
  recs: Map<string, CallRec>;
  cwd: string; // resolved once → project derivation
  sentinel: boolean; // session contains the usage-probe sentinel
};

const fileCache = new Map<string, FileCache>();
let loaded = false;
let dirty = false;

function loadSidecar(): void {
  loaded = true;
  try {
    const s = JSON.parse(fs.readFileSync(SIDECAR, "utf8"));
    if (!s || s.version !== SIDECAR_VERSION || !s.files) return;
    for (const [file, fc] of Object.entries<{
      offset?: number;
      cwd?: string;
      sentinel?: boolean;
      recs?: CallRec[];
    }>(s.files)) {
      const recs = new Map<string, CallRec>();
      for (const r of fc.recs ?? []) recs.set(r.id, r);
      fileCache.set(file, {
        offset: fc.offset ?? 0,
        recs,
        cwd: fc.cwd ?? "",
        sentinel: !!fc.sentinel,
      });
    }
  } catch {
    // no/corrupt sidecar — cold build from scratch
  }
}

function saveSidecar(): void {
  try {
    fs.mkdirSync(HQ_DIR, { recursive: true });
    const files: Record<string, unknown> = {};
    for (const [file, c] of fileCache) {
      files[file] = { offset: c.offset, cwd: c.cwd, sentinel: c.sentinel, recs: [...c.recs.values()] };
    }
    const tmp = `${SIDECAR}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: SIDECAR_VERSION, files }));
    fs.renameSync(tmp, SIDECAR); // atomic — never leave a half-written index
  } catch {
    // best-effort persistence; the in-memory cache still works this process
  }
}

function parseNewLines(file: string, cache: FileCache): void {
  const size = fs.statSync(file).size;
  if (size < cache.offset) {
    cache.offset = 0;
    cache.recs = new Map();
    dirty = true;
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
  dirty = true;

  for (const line of text.slice(0, lastNewline).split("\n")) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cache.cwd && typeof e.cwd === "string") cache.cwd = e.cwd;
    if (!cache.sentinel && e?.message?.role === "user") {
      const c = e.message.content;
      const txt = typeof c === "string" ? c : JSON.stringify(c);
      if (txt.includes(USAGE_PROBE_SENTINEL)) cache.sentinel = true;
    }
    const u = e?.message?.usage;
    if (!u) continue;
    const t = Date.parse(e?.timestamp);
    if (Number.isNaN(t)) continue;
    const id: string = e?.requestId ?? e?.message?.id ?? `_n${cache.recs.size}`;
    cache.recs.set(id, {
      id,
      ts: t,
      at: e.timestamp,
      model: e?.message?.model,
      input: u.input_tokens ?? 0,
      cw: u.cache_creation_input_tokens ?? 0,
      cr: u.cache_read_input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      sidechain: e?.isSidechain === true,
      entrypoint: typeof e?.entrypoint === "string" ? e.entrypoint : undefined,
    });
  }
}

function allTranscripts(): string[] {
  const out: string[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dp = path.join(PROJECTS_ROOT, dir.name);
    let names: string[];
    try {
      names = fs.readdirSync(dp);
    } catch {
      continue;
    }
    for (const f of names) if (f.endsWith(".jsonl")) out.push(path.join(dp, f));
  }
  return out;
}

function refreshCache(): void {
  if (!loaded) loadSidecar();
  const live = new Set(allTranscripts());
  // drop cache entries for sessions that were deleted on disk
  for (const f of fileCache.keys()) {
    if (!live.has(f)) {
      fileCache.delete(f);
      dirty = true;
    }
  }
  for (const file of live) {
    let cache = fileCache.get(file);
    if (!cache) {
      cache = { offset: 0, recs: new Map(), cwd: "", sentinel: false };
      fileCache.set(file, cache);
    }
    try {
      parseNewLines(file, cache);
    } catch {
      // unreadable / vanished mid-scan — skip
    }
  }
  if (dirty) {
    saveSidecar();
    dirty = false;
  }
}

function projectOf(file: string, cwd: string, meta: SessionsMeta): string {
  const override = meta[path.basename(file, ".jsonl")]?.project;
  if (override) return override;
  return cwd && cwd !== os.homedir() ? path.basename(cwd) : "Unassigned";
}

// Shape one cached record into a priced, labeled Call.
function toCall(file: string, r: CallRec, sentinel: boolean, project: string): Call {
  const { usd, premium } = callCost({
    model: r.model,
    input: r.input,
    cacheCreate: r.cw,
    cacheRead: r.cr,
    output: r.out,
  });
  const kind: CallKind = sentinel
    ? "hook/usage"
    : r.sidechain
      ? "subagent"
      : r.entrypoint === "sdk-cli"
        ? "headless"
        : "interactive";
  return {
    id: r.id,
    at: r.at,
    session: path.basename(file, ".jsonl"),
    project,
    kind,
    model: modelTier(r.model).toLowerCase(),
    input: r.input,
    cacheCreate: r.cw,
    cacheRead: r.cr,
    output: r.out,
    raw: r.input + r.cw + r.cr + r.out,
    weightedTokens: weighted({
      input: r.input,
      cacheCreate: r.cw,
      cacheRead: r.cr,
      output: r.out,
      messages: 1,
    }),
    cost: usd,
    premium,
  };
}

// Every API call across ALL transcripts, deduped + priced + labeled, newest first.
// Cheap after the first build (incremental + persisted). The Calls page caps how
// many it RENDERS and aggregates the full list for the header/footnote.
export function getRecentCalls(): Call[] {
  refreshCache();
  const meta = getSessionsMeta();
  const calls: Call[] = [];
  for (const [file, cache] of fileCache) {
    const project = projectOf(file, cache.cwd, meta);
    for (const r of cache.recs.values()) calls.push(toCall(file, r, cache.sentinel, project));
  }
  return calls.sort((a, b) => b.at.localeCompare(a.at));
}

// One call by its requestId — for the drill-down detail view. Searches the cache
// directly (no 33k materialize/sort), so opening a call is instant.
export function getCall(id: string): Call | null {
  refreshCache();
  const meta = getSessionsMeta();
  for (const [file, cache] of fileCache) {
    const r = cache.recs.get(id);
    if (r) return toCall(file, r, cache.sentinel, projectOf(file, cache.cwd, meta));
  }
  return null;
}

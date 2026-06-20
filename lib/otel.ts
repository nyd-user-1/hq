import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// OTel cost OVERLAY. When the user opts in (CLAUDE_CODE_ENABLE_TELEMETRY=1 +
// OTEL_EXPORTER_OTLP_LOGS_ENDPOINT → HQ's /api/otel/v1/logs), Claude Code exports
// one `claude_code.api_request` log record per API round-trip carrying the REAL
// usage block (input/output/cache tokens) + its own cost_usd estimate + model +
// session id. HQ is its own OTLP/HTTP-JSON receiver (no collector dep): the route
// hands the parsed body here, we extract the api_request records and append them
// to ~/.claude/hq/otel-cost.ndjson.
//
// This is an UPGRADE OVERLAY, never the floor: it only sees sessions started
// AFTER telemetry is enabled, and only while HQ is up. lib/calls.ts's transcript-
// derived estimate stays the always-present source; guardrails read OTel when
// present (authoritative tokens) and fall back to the estimate otherwise.
//
// Honesty note: Claude Code's cost_usd is itself a client-side ESTIMATE (not the
// billing API), but it carries ground-truth token counts the transcript parse
// can only approximate. So OTel upgrades "HQ's estimate" → "Claude Code's
// estimate + real tokens", not to invoice truth.

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const LOG = path.join(HQ_DIR, "otel-cost.ndjson");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// One normalized cost record (one API round-trip).
export type OtelCost = {
  id: string; // requestId when present, else a synthesized line id
  at: number; // ms
  sessionId: string;
  model: string;
  costUsd: number; // Claude Code's own cost estimate for the call
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  querySource: string; // user_message | subagent | … (attribution)
};

// ── OTLP/HTTP-JSON parsing ───────────────────────────────────────────────────
// An OTLP attribute value is a one-key union: {stringValue|intValue|doubleValue|
// boolValue}. intValue arrives as a STRING in JSON-encoded OTLP; coerce both.
type AttrVal = {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
};
function attrNum(v: AttrVal | undefined): number {
  if (!v) return 0;
  if (typeof v.doubleValue === "number") return v.doubleValue;
  if (v.intValue != null) return Number(v.intValue) || 0;
  if (v.stringValue != null) return Number(v.stringValue) || 0;
  return 0;
}
function attrStr(v: AttrVal | undefined): string {
  if (!v) return "";
  if (typeof v.stringValue === "string") return v.stringValue;
  if (v.intValue != null) return String(v.intValue);
  return "";
}

type LogRecord = {
  timeUnixNano?: string | number;
  observedTimeUnixNano?: string | number;
  body?: { stringValue?: string };
  attributes?: { key: string; value?: AttrVal }[];
};

// Pull the api_request log records out of an OTLP/HTTP-JSON logs envelope and
// append each as a normalized OtelCost line. Returns how many were recorded.
// Never throws — a hook/exporter firing into a half-up server must not 500.
export function recordOtelLogs(payload: unknown): number {
  const root = payload as {
    resourceLogs?: { scopeLogs?: { logRecords?: LogRecord[] }[] }[];
  };
  const records: LogRecord[] = [];
  for (const rl of root?.resourceLogs ?? [])
    for (const sl of rl?.scopeLogs ?? [])
      for (const lr of sl?.logRecords ?? []) records.push(lr);

  const lines: string[] = [];
  for (const lr of records) {
    const attrs = new Map<string, AttrVal>();
    for (const a of lr.attributes ?? []) if (a?.key) attrs.set(a.key, a.value ?? {});
    // The event name lives in an `event.name` attribute (newer exporters) or the
    // log body. We only care about the per-call cost event.
    const name = attrStr(attrs.get("event.name")) || lr.body?.stringValue || "";
    if (name !== "claude_code.api_request") continue;

    const nano = Number(lr.timeUnixNano ?? lr.observedTimeUnixNano ?? 0);
    const at = nano > 0 ? Math.round(nano / 1e6) : Date.now();
    const rec: OtelCost = {
      id:
        attrStr(attrs.get("request_id")) ||
        attrStr(attrs.get("requestId")) ||
        `o_${at.toString(36)}${lines.length.toString(36)}`,
      at,
      sessionId: attrStr(attrs.get("session.id")) || attrStr(attrs.get("session_id")),
      model: attrStr(attrs.get("model")),
      costUsd: attrNum(attrs.get("cost_usd")),
      input: attrNum(attrs.get("input_tokens")),
      output: attrNum(attrs.get("output_tokens")),
      cacheRead: attrNum(attrs.get("cache_read_tokens")),
      cacheCreate: attrNum(attrs.get("cache_creation_tokens")),
      querySource: attrStr(attrs.get("query_source")) || attrStr(attrs.get("terminal_type")),
    };
    lines.push(JSON.stringify(rec));
  }

  if (lines.length === 0) return 0;
  try {
    fs.mkdirSync(HQ_DIR, { recursive: true });
    fs.appendFileSync(LOG, lines.join("\n") + "\n");
  } catch {
    return 0; // best-effort sink
  }
  return lines.length;
}

// ── incremental, offset-cached read (same trick as lib/events.ts) ─────────────
let cachedOffset = 0;
let cachedRecs: OtelCost[] = [];

function refresh(): void {
  let size: number;
  try {
    size = fs.statSync(LOG).size;
  } catch {
    cachedOffset = 0;
    cachedRecs = [];
    return;
  }
  if (size < cachedOffset) {
    cachedOffset = 0;
    cachedRecs = [];
  }
  if (size === cachedOffset) return;
  let buf: Buffer;
  try {
    const fd = fs.openSync(LOG, "r");
    buf = Buffer.alloc(size - cachedOffset);
    fs.readSync(fd, buf, 0, buf.length, cachedOffset);
    fs.closeSync(fd);
  } catch {
    return;
  }
  const text = buf.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) return;
  cachedOffset += Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");
  for (const line of text.slice(0, lastNewline).split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as OtelCost;
      if (typeof r?.at === "number") cachedRecs.push(r);
    } catch {
      // skip a torn line
    }
  }
}

function recs(): OtelCost[] {
  refresh();
  return cachedRecs;
}

// Is there any OTel cost data at all? (Drives the "measured vs estimate" UI.)
export function otelAvailable(): boolean {
  return recs().length > 0;
}

// Summed cost_usd over a trailing window (ms).
export function spendByWindow(ms: number): number {
  const floor = Date.now() - ms;
  let s = 0;
  for (const r of recs()) if (r.at >= floor) s += r.costUsd;
  return s;
}

export function weeklySpend(): number {
  return spendByWindow(WEEK_MS);
}

// Per-session measured cost (trailing week), newest activity first.
export type OtelSession = { sessionId: string; cost: number; calls: number; lastAt: number };
export function costBySession(): OtelSession[] {
  const floor = Date.now() - WEEK_MS;
  const by = new Map<string, OtelSession>();
  for (const r of recs()) {
    if (r.at < floor || !r.sessionId) continue;
    const s = by.get(r.sessionId) ?? { sessionId: r.sessionId, cost: 0, calls: 0, lastAt: 0 };
    s.cost += r.costUsd;
    s.calls += 1;
    if (r.at > s.lastAt) s.lastAt = r.at;
    by.set(r.sessionId, s);
  }
  return [...by.values()].sort((a, b) => b.cost - a.cost);
}

// Backstop state, ledger, and model mapping. Pure node — shared by the daemon
// and the installer. hq's Next app reads the same files through lib/backstop.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HQ_BACKSTOP_DIR lets the self-test run against a scratch directory instead of
// the live sidecars.
export const HQ_DIR = process.env.HQ_BACKSTOP_DIR || path.join(os.homedir(), ".claude", "hq");
export const STATE_FILE = path.join(HQ_DIR, "backstop.json");
export const LEDGER_FILE = path.join(HQ_DIR, "backstop.jsonl");
export const LOG_FILE = path.join(HQ_DIR, "backstop.log");
export const DEFAULT_PORT = 3141;

export const DEFAULT_STATE = {
  mode: "off", // "off" = passthrough on the user's own plan; "on" = drawing on backstop capacity
  provider: "bedrock", // bedrock | bedrock-mantle | anthropic
  region: "us-east-1",
  engagedAt: null,
  engagedReason: null,
  simulateLimit: false, // test-only: forge the usage wall on the passthrough path
  upstreamOverride: null, // test-only: point a driver at a local mock
  spentUsd: 0,
  requests: 0,
  // Health of the backstop upstream itself. When it cannot serve, the gateway
  // falls back to the user's plan and counts the failure here; past the
  // threshold `degradedUntil` opens a breaker so a dead provider stops costing
  // a round-trip per turn.
  consecutiveFailures: 0,
  degradedUntil: 0,
  lastDriverError: null,
  lastDriverErrorAt: null,
};

export function readState() {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Atomic write — the daemon and the UI both touch this file. */
export function writeState(next) {
  fs.mkdirSync(HQ_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  return next;
}

export function patchState(patch) {
  return writeState({ ...readState(), ...patch });
}

// Rates in USD per million tokens. Only used for the drawdown display —
// the authoritative bill is the provider's.
const RATES = {
  opus: { in: 5, out: 25 },
  fable: { in: 10, out: 50 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
};

export function rateFor(model = "") {
  const m = model.toLowerCase();
  if (m.includes("fable") || m.includes("mythos")) return RATES.fable;
  if (m.includes("opus")) return RATES.opus;
  if (m.includes("haiku")) return RATES.haiku;
  return RATES.sonnet;
}

export function costOf(model, usage = {}) {
  const r = rateFor(model);
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return (
    (input * r.in + cacheWrite * r.in * 1.25 + cacheRead * r.in * 0.1 + output * r.out) / 1_000_000
  );
}

/**
 * Append one metered request. ONLY called for backstop-routed traffic —
 * passthrough traffic is never recorded. No prompt or response content is
 * written, only token counts.
 */
export function appendLedger(entry) {
  fs.mkdirSync(HQ_DIR, { recursive: true });
  fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(entry)}\n`);
}

export function readLedger(limit = 200) {
  try {
    const lines = fs.readFileSync(LEDGER_FILE, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

// --- Model mapping ------------------------------------------------------
// Claude Code sends first-party aliases (sometimes date-suffixed). Classic
// Bedrock requires a cross-region inference profile id; Mantle takes a bare
// `anthropic.`-prefixed alias.

const BEDROCK_PROFILES = {
  "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "claude-sonnet-4-5": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "claude-opus-4-5": "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "claude-opus-4-1": "us.anthropic.claude-opus-4-1-20250805-v1:0",
  "claude-sonnet-4": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-opus-4-6": "us.anthropic.claude-opus-4-6-v1:0",
  "claude-opus-4-7": "us.anthropic.claude-opus-4-7",
  "claude-opus-4-8": "us.anthropic.claude-opus-4-8",
  "claude-opus-5": "us.anthropic.claude-opus-5",
  "claude-sonnet-5": "us.anthropic.claude-sonnet-5",
  "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-6",
  "claude-fable-5": "us.anthropic.claude-fable-5",
};

/** Strip a trailing -YYYYMMDD date suffix to get the canonical alias. */
export function canonicalAlias(model = "") {
  return model.replace(/-\d{8}$/, "").replace(/-v\d+:\d+$/, "");
}

export function toBedrockModel(model) {
  const alias = canonicalAlias(model);
  if (BEDROCK_PROFILES[alias]) return BEDROCK_PROFILES[alias];
  // Unknown alias: assume the newer bare-alias profile naming rather than fail.
  return alias.startsWith("us.") || alias.startsWith("anthropic.")
    ? alias
    : `us.anthropic.${alias}`;
}

export function toMantleModel(model) {
  const alias = canonicalAlias(model);
  return alias.startsWith("anthropic.") ? alias : `anthropic.${alias}`;
}

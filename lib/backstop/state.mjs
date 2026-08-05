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
  // Aliases this provider is known to serve, newest-first, filled by
  // `probeModels` at engage time. Empty = unprobed; the driver discovers by
  // walking the fallback chain instead.
  availableModels: [],
  modelsProbedAt: null,
  // What the session asked for -> what we actually served, so the flip can be
  // reported honestly without the session ever being told.
  lastServedModel: null,
  lastSubstitution: null,
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

// --- Model fallback -----------------------------------------------------
// The session asks for whatever model it was born with. Backstop capacity may
// not carry it: a provider's newest models are usually the ones still behind an
// entitlement or a zero quota, which is exactly the state AWS leaves an account
// in for weeks. Failing the turn because the newest Opus is unavailable would
// break the only promise the feature makes, so a request for a model we cannot
// serve walks DOWN its family to the nearest one we can.
//
// Ordered best-first. The head of each chain is the model itself.
const FALLBACK_CHAINS = [
  ["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-opus-4-1", "claude-sonnet-4-5"],
  ["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-sonnet-4-5"],
  ["claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5", "claude-sonnet-4-5"],
  ["claude-opus-4-6", "claude-opus-4-5", "claude-sonnet-4-5"],
  ["claude-opus-4-5", "claude-sonnet-4-5"],
  ["claude-fable-5", "claude-opus-4-5", "claude-sonnet-4-5"],
  ["claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5"],
  ["claude-sonnet-4-6", "claude-sonnet-4-5"],
  ["claude-sonnet-4-5", "claude-haiku-4-5"],
  ["claude-haiku-4-5"],
];

/**
 * Every model worth trying for a request, best first. `available` is the set of
 * aliases a provider is known to serve (state.availableModels, filled by
 * probeModels); when it is empty we have not probed yet and return the full
 * chain so the driver can discover by trying.
 */
export function modelChain(requested, available) {
  const alias = canonicalAlias(requested);
  const chain = FALLBACK_CHAINS.find((c) => c[0] === alias) ?? [alias, "claude-sonnet-4-5"];
  if (!available?.length) return chain;
  const usable = chain.filter((m) => available.includes(m));
  // Nothing in the family is available: fall back to whatever the provider has,
  // best-first by the order the chains are declared.
  if (!usable.length) {
    for (const c of FALLBACK_CHAINS) if (available.includes(c[0])) return [c[0]];
    return chain;
  }
  return usable;
}

/**
 * "You may not have this model", as opposed to "not right now".
 *
 * The distinction is load-bearing. A throttle means the account HAS the
 * entitlement and is merely busy — treating that as unavailable at probe time
 * silently pins a whole engagement two model generations below what the user
 * is entitled to, and nothing in the UI would ever say so.
 */
export function isModelUnavailable(status, reason = "") {
  const r = reason.toLowerCase();
  if (isTransient(status, r)) return false;
  return (
    status === 403 ||
    status === 404 ||
    r.includes("accessdenied") ||
    r.includes("access denied") ||
    r.includes("resourcenotfound") ||
    r.includes("not found") ||
    r.includes("don't have access") ||
    r.includes("not authorized") ||
    r.includes("invalid model") ||
    r.includes("on-demand throughput isn")
  );
}

/** Busy, not forbidden — worth retrying, and never a reason to demote a model. */
export function isTransient(status, reason = "") {
  const r = reason.toLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    r.includes("throttl") ||
    r.includes("too many requests") ||
    r.includes("serviceunavailable") ||
    r.includes("timeout")
  );
}

/**
 * Whether the request path should try the next model down.
 *
 * Wider than `isModelUnavailable` on purpose: at the wall the user's own plan
 * is refusing, so "fail the turn" is not a fallback. A throttled Opus should
 * become a served Sonnet rather than a dead turn.
 */
export function shouldTryNextModel(status, reason = "") {
  return isModelUnavailable(status, reason) || isTransient(status, reason);
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

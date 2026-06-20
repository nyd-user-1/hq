import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRecentCalls } from "./calls";
import { getSpend } from "./usage";
import { premiumBleed } from "./pricing";
import { PRICING_CLIFF, CONTEXT_LIMIT } from "./limits";
import { otelAvailable, weeklySpend as otelWeek, spendByWindow as otelWindow } from "./otel";

// Cost GUARDRAILS — the read side of the "don't blow the weekly cap again" work
// (we hit the limit two days early when a warm REPL's context ballooned to ~880k,
// billing every re-read at the 2× cliff). This is VISIBILITY + ALARM, computed
// from the same priced calls the Ledger shows (lib/calls.ts, an estimate that
// works today). When OTel is enabled it surfaces the authoritative measured cost
// alongside as a cross-check. Enforcement is out of scope here: HQ can't compact a
// live external session (the AGENTS.md HARD CEILING) — its only lever is stopping
// an HQ-spawned REPL run.

const HQ_DIR = path.join(os.homedir(), ".claude", "hq");
const CONFIG = path.join(HQ_DIR, "guardrails.json");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BURN_WINDOW_MS = 15 * 60 * 1000; // live $/min over the last 15 min

// User-set caps (~/.claude/hq/guardrails.json). Defaults are illustrative — the
// real Anthropic weekly $-limit isn't exposed to HQ, so `configured:false` nudges
// the user to set their own.
export type GuardrailConfig = {
  weeklyCapUSD: number;
  burnRateAlertUSD: number; // $/min that trips the live burn alarm
  configured: boolean;
};
const DEFAULTS: Omit<GuardrailConfig, "configured"> = {
  weeklyCapUSD: 100,
  burnRateAlertUSD: 5,
};

export function readConfig(): GuardrailConfig {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    return {
      weeklyCapUSD: Number(c.weeklyCapUSD) > 0 ? Number(c.weeklyCapUSD) : DEFAULTS.weeklyCapUSD,
      burnRateAlertUSD:
        Number(c.burnRateAlertUSD) > 0 ? Number(c.burnRateAlertUSD) : DEFAULTS.burnRateAlertUSD,
      configured: true,
    };
  } catch {
    return { ...DEFAULTS, configured: false };
  }
}

export const GUARDRAILS_CONFIG_PATH = CONFIG;

type Status = "ok" | "warn" | "critical";

export type GuardrailSession = {
  sessionId: string;
  project: string;
  cost: number; // week $ (estimate)
  calls: number;
  context: number; // latest call's context-input tokens (the cliff metric)
  premium: boolean; // latest context past the 200k cliff
  lastAt: number;
};

export type Guardrails = {
  cap: GuardrailConfig;
  spend: { session: number; today: number; week: number }; // estimate
  measured: { available: boolean; week: number; day: number }; // OTel overlay
  usage: { pct: number; status: Status; projectedDays: number | null }; // week vs cap
  burn: { perMin: number; perHour: number; dayBurn: number; status: Status };
  bleed: { week: number; share: number }; // 2× cliff surcharge $ + share of week
  sessions: GuardrailSession[]; // top spenders this week
  cliff: number; // PRICING_CLIFF, for the UI
  contextLimit: number; // CONTEXT_LIMIT, for the meter
};

export function getGuardrails(topN = 8): Guardrails {
  const cap = readConfig();
  const spend = getSpend();
  const now = Date.now();
  const calls = getRecentCalls();

  let burnWindowSpend = 0;
  let dayBurn = 0;
  let weekBleed = 0;
  // session id -> rolling aggregate over the week
  const byId = new Map<string, GuardrailSession & { _latest: number }>();

  for (const c of calls) {
    const t = Date.parse(c.at);
    if (Number.isNaN(t) || now - t > WEEK_MS) continue;
    if (now - t <= BURN_WINDOW_MS) burnWindowSpend += c.cost;
    if (now - t <= DAY_MS) dayBurn += c.cost;
    weekBleed += premiumBleed({
      model: c.model,
      input: c.input,
      cacheCreate: c.cacheCreate,
      cacheRead: c.cacheRead,
      output: c.output,
    });
    const ctx = c.input + c.cacheCreate + c.cacheRead; // context-input (cliff metric)
    const s =
      byId.get(c.session) ??
      ({
        sessionId: c.session,
        project: c.project,
        cost: 0,
        calls: 0,
        context: 0,
        premium: false,
        lastAt: 0,
        _latest: 0,
      } as GuardrailSession & { _latest: number });
    s.cost += c.cost;
    s.calls += 1;
    if (t > s.lastAt) s.lastAt = t;
    if (t >= s._latest) {
      // newest call defines the "current" context size + premium flag
      s._latest = t;
      s.context = ctx;
      s.premium = ctx > PRICING_CLIFF;
      s.project = c.project;
    }
    byId.set(c.session, s);
  }

  const perMin = burnWindowSpend / (BURN_WINDOW_MS / 60000);
  const burnStatus: Status =
    perMin >= cap.burnRateAlertUSD ? "critical" : perMin >= cap.burnRateAlertUSD * 0.5 ? "warn" : "ok";

  const pct = cap.weeklyCapUSD > 0 ? spend.week / cap.weeklyCapUSD : 0;
  const usageStatus: Status = pct >= 1 ? "critical" : pct >= 0.8 ? "warn" : "ok";
  const remaining = Math.max(0, cap.weeklyCapUSD - spend.week);
  // Project at the trailing-day burn — null when idle (no burn) or already over.
  const projectedDays = dayBurn > 0 && remaining > 0 ? remaining / dayBurn : null;

  const sessions = [...byId.values()]
    .map(({ _latest, ...s }) => s) // drop the internal sort key
    .sort((a, b) => b.cost - a.cost)
    .slice(0, topN);

  return {
    cap,
    spend: { session: spend.session, today: spend.today, week: spend.week },
    measured: {
      available: otelAvailable(),
      week: otelWeek(),
      day: otelWindow(DAY_MS),
    },
    usage: { pct, status: usageStatus, projectedDays },
    burn: { perMin, perHour: perMin * 60, dayBurn, status: burnStatus },
    bleed: { week: weekBleed, share: spend.week > 0 ? weekBleed / spend.week : 0 },
    sessions,
    cliff: PRICING_CLIFF,
    contextLimit: CONTEXT_LIMIT,
  };
}

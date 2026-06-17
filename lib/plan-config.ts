import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Planner config sidecar — ~/.claude/hq/planner.json. Holds the user's billing
// tier (which controls the KPI headline), seat count (API tiers scale dollars
// linearly), target model, and the planner's knobs. tier=null means "not asked
// yet" → the panel prompts on first open, then persists. Always overridable.

const DIR = path.join(os.homedir(), ".claude", "hq");
const FILE = path.join(DIR, "planner.json");

export type Tier = "basic" | "pro" | "max" | "team" | "enterprise";

export type PlanConfig = {
  tier: Tier | null; // null = first-run, ask
  seats: number; // API tiers: absolute dollars × seats (savings % is seat-invariant)
  model: string; // priced + weighted via lib/pricing + lib/usage
  maxBatch: number; // quality ceiling per batch
  turnGapSeconds: number; // est inter-turn latency; > cache TTL erodes the discount
  cacheTtlSeconds: number; // 300 (5-min) default; 3600 if you opt into the 1-hr cache
};

const DEFAULTS: PlanConfig = {
  tier: null,
  seats: 1,
  model: "claude-opus-4-8",
  maxBatch: 4,
  turnGapSeconds: 60,
  cacheTtlSeconds: 300,
};

// API/pay-per-token tiers → dollar headline + seat scaling. Subscription tiers →
// throughput headline.
export function isApiTier(t: Tier | null): boolean {
  return t === "team" || t === "enterprise";
}

export function getPlanConfig(): PlanConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setPlanConfig(patch: Partial<PlanConfig>): PlanConfig {
  const next: PlanConfig = { ...getPlanConfig(), ...patch };
  next.seats = Math.max(1, Math.floor(Number(next.seats) || 1));
  next.maxBatch = Math.max(1, Math.floor(Number(next.maxBatch) || 4));
  next.turnGapSeconds = Math.max(0, Number(next.turnGapSeconds) || 0);
  next.cacheTtlSeconds = Math.max(60, Number(next.cacheTtlSeconds) || 300);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}

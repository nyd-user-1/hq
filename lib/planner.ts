import { getTodos, type TodoItem } from "./todo";
import {
  planBatches,
  summarizePlan,
  batchCost,
  soloCost,
  type TaskNode,
  type CostParams,
  type Plan,
  type PlanSummary,
} from "./batch-planner";
import { coldContext, fileTokens, type ColdContext } from "./calibration";
import { resolveFile } from "./files";
import { getPlanConfig, isApiTier, type PlanConfig } from "./plan-config";
import { getForecast, modelWeight } from "./usage";

// Stage-2 composition: read enriched todos → build the plan → roll up BOTH KPIs
// (dollars and throughput) → attach the stateful "tasks before reset" figure
// from live telemetry. The billing tier only decides which KPI is the headline;
// both are always computed. Everything calibrated (cold context as a p50/p90
// range, per-file tokens from disk) — no assumed constants survive to here.

// A todo counts as "evaluated" once the Stage-1 evaluator has given it graph
// data (an effort estimate or at least one write target).
function isEvaluated(t: TodoItem): boolean {
  return typeof t.effort === "number" || (Array.isArray(t.writes) && t.writes.length > 0);
}

function toNodes(todos: TodoItem[]): TaskNode[] {
  return todos.map((t) => ({
    id: t.id,
    writes: Array.isArray(t.writes) ? t.writes : [],
    reads: Array.isArray(t.reads) ? t.reads : [],
    dependsOn: Array.isArray(t.dependsOn)
      ? t.dependsOn.filter((d) => typeof d === "string")
      : [],
    effort: typeof t.effort === "number" ? t.effort : 500,
  }));
}

export type ThroughputView = {
  remainingWeighted: number; // live capacity left in the current reset window
  usedWeighted: number; // burned so far this window
  limitWeighted: number; // the window cap
  windowPct: number; // 0..1 used (for the burn gauge)
  blockReset: number; // ms timestamp of the next reset
  tasksLeftSolo: number; // "X tasks before reset" if done one-at-a-time
  tasksLeftBatched: number; // …if batched
  multiplier: number; // batched / solo (≥1 ⇒ more work per reset)
  planWeighted: number; // model-scaled weighted to run the WHOLE batched plan once
  runsBeforeReset: number; // how many full-plan runs fit in the remaining window
  planPctOfRemaining: number; // share of the remaining window one run consumes (0..1+)
};

// One chip in a batch's "files" row — the evaluator's guessed path, RESOLVED
// against the real tree (lib/files.ts). `exists` lets the panel mark a real file
// (copyable) vs. a hallucinated path (struck) — an honest quality signal on the
// evaluator, not a link to a file we can't confirm exists.
export type BatchFile = {
  name: string; // basename for display
  copy: string; // path to click-to-copy (resolved repo-rel, else the raw guess)
  exists: boolean; // resolved to a real file on disk
  ambiguous: boolean; // basename matched >1 file (best-guess shown)
};

// One batch, enriched for the panel: the files it touches, its cost, and turns —
// so a batch card reads like a session card (cost · turns · files), not a bare list.
export type BatchDetail = {
  id: string;
  stage: number;
  serialAfter?: string;
  taskIds: string[];
  files: BatchFile[];
  usd: number; // batch cost, seat-scaled, p50 cold-context
  savings: number; // un-batched − batched for THIS batch's tasks, seat-scaled
  outTokens: number; // Σ estimated output tokens (the batch's generation size)
  weighted: number;
  premiumTurns: number;
};

export type DollarsView = {
  seats: number;
  // p50 / p90 bracket the cold-context range → a savings RANGE, not a point.
  soloP50: number;
  batchedP50: number;
  savingsP50: number;
  savingsPctP50: number;
  soloP90: number;
  batchedP90: number;
  savingsP90: number;
  savingsPctP90: number;
  annualSavingsP50: number;
  annualSavingsP90: number;
  runsPerYear: number;
};

export type PlannerView = {
  config: PlanConfig;
  needsTier: boolean;
  headline: "throughput" | "dollars";
  activeCount: number;
  evaluatedCount: number;
  unevaluatedCount: number;
  tasks: { id: string; title: string }[];
  cold: ColdContext;
  plan: Plan;
  batches: BatchDetail[];
  summaryP50: PlanSummary;
  summaryP90: PlanSummary;
  throughput: ThroughputView;
  dollars: DollarsView;
};

// Documented assumption (configurable later): 20 sessions/day × 250 working
// days. A "run" here = planning + executing the current active backlog once.
const RUNS_PER_YEAR = 5000;

export function buildPlannerView(): PlannerView {
  const cfg = getPlanConfig();
  const todos = getTodos();
  const active = todos.filter((t) => !t.done && !t.parentId);
  const evaluatedCount = active.filter(isEvaluated).length;
  const nodes = toNodes(active);
  const cold = coldContext();
  const plan = planBatches(nodes, { maxBatch: cfg.maxBatch });

  const params = (coldTokens: number): CostParams => ({
    model: cfg.model,
    coldContextTokens: coldTokens,
    fileTokens,
    turnGapSeconds: cfg.turnGapSeconds,
    cacheTtlSeconds: cfg.cacheTtlSeconds,
  });
  const summaryP50 = summarizePlan(plan, nodes, params(cold.p50));
  const summaryP90 = summarizePlan(plan, nodes, params(cold.p90));

  // Stateful throughput: the planner's per-task weighted burn vs LIVE remaining
  // capacity in the current reset window. weighted() is model-agnostic, so scale
  // by the model weight to match the calibrated SESSION_LIMIT_WEIGHTED units.
  const fc = getForecast();
  const remaining = Math.max(fc.limit - fc.blockWeighted, 0);
  const mw = modelWeight(cfg.model);
  const n = Math.max(nodes.length, 1);
  const perTaskSolo = (summaryP50.soloWeighted / n) * mw;
  const perTaskBatched = (summaryP50.batchedWeighted / n) * mw;
  const planWeighted = summaryP50.batchedWeighted * mw; // whole batched plan, model-scaled
  const throughput: ThroughputView = {
    remainingWeighted: remaining,
    usedWeighted: fc.blockWeighted,
    limitWeighted: fc.limit,
    windowPct: fc.limit > 0 ? Math.min(1, fc.blockWeighted / fc.limit) : 0,
    blockReset: fc.blockReset,
    tasksLeftSolo: perTaskSolo > 0 ? Math.floor(remaining / perTaskSolo) : 0,
    tasksLeftBatched: perTaskBatched > 0 ? Math.floor(remaining / perTaskBatched) : 0,
    multiplier: summaryP50.throughputMultiplier,
    planWeighted,
    runsBeforeReset: planWeighted > 0 ? Math.floor(remaining / planWeighted) : 0,
    planPctOfRemaining: remaining > 0 ? planWeighted / remaining : 0,
  };

  // Seat scaling: API tiers multiply absolute $ by seats (the % is seat-invariant).
  const seats = isApiTier(cfg.tier) ? cfg.seats : 1;

  // Per-batch detail — files touched + cost, so each card reads like a session card.
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const p50params = params(cold.p50);
  const batches: BatchDetail[] = plan.batches.map((b) => {
    const c = batchCost(b.taskIds, byId, p50params);
    let soloUsd = 0;
    let outTokens = 0;
    for (const id of b.taskIds) {
      const t = byId.get(id);
      if (!t) continue;
      soloUsd += soloCost(t, p50params).usd;
      outTokens += t.effort;
    }
    const files: BatchFile[] = [
      ...new Set(
        b.taskIds.flatMap((id) => {
          const t = byId.get(id);
          return t ? [...t.writes, ...t.reads] : [];
        })
      ),
    ].map((raw) => {
      const r = resolveFile(raw);
      return {
        name: (r.rel ?? raw).split("/").pop() || raw,
        copy: r.rel ?? raw,
        exists: r.exists,
        ambiguous: r.ambiguous,
      };
    });
    return {
      id: b.id,
      stage: b.stage,
      serialAfter: b.serialAfter,
      taskIds: b.taskIds,
      files,
      usd: c.usd * seats,
      savings: (soloUsd - c.usd) * seats,
      outTokens,
      weighted: c.weighted,
      premiumTurns: c.premiumTurns,
    };
  });

  const dollars: DollarsView = {
    seats,
    soloP50: summaryP50.soloUSD * seats,
    batchedP50: summaryP50.batchedUSD * seats,
    savingsP50: summaryP50.savingsUSD * seats,
    savingsPctP50: summaryP50.savingsPct,
    soloP90: summaryP90.soloUSD * seats,
    batchedP90: summaryP90.batchedUSD * seats,
    savingsP90: summaryP90.savingsUSD * seats,
    savingsPctP90: summaryP90.savingsPct,
    annualSavingsP50: summaryP50.savingsUSD * seats * RUNS_PER_YEAR,
    annualSavingsP90: summaryP90.savingsUSD * seats * RUNS_PER_YEAR,
    runsPerYear: RUNS_PER_YEAR,
  };

  return {
    config: cfg,
    needsTier: cfg.tier === null,
    headline: isApiTier(cfg.tier) ? "dollars" : "throughput",
    activeCount: active.length,
    evaluatedCount,
    unevaluatedCount: active.length - evaluatedCount,
    tasks: active.map((t) => ({ id: t.id, title: t.text })),
    cold,
    plan,
    batches,
    summaryP50,
    summaryP90,
    throughput,
    dollars,
  };
}

import { callCost, type Usage } from "./pricing";
import { weighted, type Totals } from "./usage";

// ─────────────────────────────────────────────────────────────────────────────
// HQ Batch Planner — Stage 2 of the todo batch-optimizer pipeline.
//
// Consumes the enriched task graph (writes/reads/dependsOn/effort the Stage-1
// evaluator infers onto each todo) and produces an execution plan: dependency-
// leveled STAGES, each holding BATCHES that run as one warm Claude session
// (serial turns). Batches in a stage are write-disjoint BY CONSTRUCTION, so they
// are free to run concurrently without clobbering each other's files.
//
// The cost model is deliberately NOT a fresh invention — it COMPOSES the already-
// calibrated lib/pricing.ts (caching multipliers 1.25× write / 0.1× read are
// baked into its per-model rates; the >200k long-context 2× premium is
// callCost's cliff check) and lib/usage.ts (the weighted-token rate-limit model).
// The constants pricing/usage don't own — cold context size, per-file context
// size, inter-turn latency vs the cache TTL — are INJECTED so they can be
// calibrated from real telemetry rather than hardcoded. 100k etc. are the
// CALLER's problem to measure; this file only does math.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskNode = {
  id: string;
  writes: string[];
  reads: string[];
  dependsOn: string[]; // ids
  effort: number; // estimated OUTPUT tokens
};

// One batch = one warm session. `serialAfter` (when set) is the id of a batch
// this one must follow — used only when a write-component is too big for one
// batch and must be split into a serial chain (the pieces share writes, so they
// cannot run concurrently). Batches in the same stage with no serialAfter run
// concurrently; they are guaranteed write-disjoint.
export type Batch = {
  id: string;
  stage: number;
  taskIds: string[];
  serialAfter?: string;
};

export type Plan = {
  stages: number; // count of dependency levels
  batches: Batch[];
  cyclic: string[]; // ids flagged for a dependency cycle (should be [])
};

// ── Dependency leveling — longest-path, NOT topo order. ──────────────────────
// stage(t) = 0 if no deps, else 1 + max(stage(dep)). This is the fix for the
// prototype's bug: co-batching only WITHIN a level guarantees a dependent never
// lands in an earlier-executing batch than its dependency.
export function levelize(tasks: TaskNode[]): {
  level: Map<string, number>;
  cyclic: string[];
} {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const level = new Map<string, number>();
  const onStack = new Set<string>();
  const cyclic: string[] = [];

  function depth(id: string): number {
    const cached = level.get(id);
    if (cached !== undefined) return cached;
    const t = byId.get(id);
    if (!t) return 0; // dep outside this set → treat as a satisfied root
    if (onStack.has(id)) {
      cyclic.push(id); // back-edge → cycle; break it by treating as a root
      return 0;
    }
    onStack.add(id);
    let d = 0;
    for (const dep of t.dependsOn) {
      if (byId.has(dep)) d = Math.max(d, 1 + depth(dep));
    }
    onStack.delete(id);
    level.set(id, d);
    return d;
  }

  for (const t of tasks) depth(t.id);
  return { level, cyclic: [...new Set(cyclic)] };
}

// ── Write-connected components: tasks sharing a write file are unioned, so a
//    component is the atomic unit that must NOT be split across concurrent
//    batches. Disjoint components are free to run in parallel. ────────────────
function writeComponents(tasks: TaskNode[]): TaskNode[][] {
  const parent = new Map<string, string>();
  for (const t of tasks) parent.set(t.id, t.id);
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!); // path halving
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const writerOf = new Map<string, string>(); // file → first task seen writing it
  for (const t of tasks) {
    for (const f of t.writes) {
      const prev = writerOf.get(f);
      if (prev) union(prev, t.id);
      else writerOf.set(f, t.id);
    }
  }

  const groups = new Map<string, TaskNode[]>();
  for (const t of tasks) {
    const r = find(t.id);
    const g = groups.get(r);
    if (g) g.push(t);
    else groups.set(r, [t]);
  }
  return [...groups.values()];
}

// Shared READ files between two task sets — the soft signal for warm-context
// cohesion (reads don't collide, so they only influence packing, not legality).
function readCohesion(a: TaskNode[], b: TaskNode[]): number {
  const ra = new Set(a.flatMap((t) => t.reads));
  let n = 0;
  for (const t of b) for (const f of t.reads) if (ra.has(f)) n++;
  return n;
}

function packStage(
  stageTasks: TaskNode[],
  maxBatch: number,
  stage: number,
  idBase: string
): Batch[] {
  const batches: Batch[] = [];
  let n = 0;
  const small: TaskNode[][] = [];

  // 1) Oversized write-components → a serial chain (pieces share writes, so they
  //    cannot run concurrently; chain them with serialAfter).
  for (const comp of writeComponents(stageTasks)) {
    if (comp.length > maxBatch) {
      let prev: string | undefined;
      for (let i = 0; i < comp.length; i += maxBatch) {
        const id = `${idBase}-${n++}`;
        batches.push({
          id,
          stage,
          taskIds: comp.slice(i, i + maxBatch).map((t) => t.id),
          serialAfter: prev,
        });
        prev = id;
      }
    } else {
      small.push(comp);
    }
  }

  // 2) Bin-pack the small (atomic) components into bins ≤ maxBatch. First-fit by
  //    descending size, tie-broken toward the bin with the most shared reads
  //    (warm context). A component is never split, so every bin owns a disjoint
  //    set of write files → bins are write-disjoint and run concurrently.
  //    Heuristic, not optimal (bin-packing is NP-hard) — and it's honest to say
  //    so rather than dress it up as constraint satisfaction.
  small.sort((a, b) => b.length - a.length);
  const bins: TaskNode[][] = [];
  for (const comp of small) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < bins.length; i++) {
      if (bins[i].length + comp.length > maxBatch) continue;
      const score = readCohesion(bins[i], comp);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) bins[best].push(...comp);
    else bins.push([...comp]);
  }
  for (const bin of bins) {
    batches.push({ id: `${idBase}-${n++}`, stage, taskIds: bin.map((t) => t.id) });
  }
  return batches;
}

export function planBatches(
  tasks: TaskNode[],
  opts: { maxBatch?: number } = {}
): Plan {
  const maxBatch = Math.max(1, opts.maxBatch ?? 4);
  const { level, cyclic } = levelize(tasks);
  const byStage = new Map<number, TaskNode[]>();
  for (const t of tasks) {
    const s = level.get(t.id) ?? 0;
    const g = byStage.get(s);
    if (g) g.push(t);
    else byStage.set(s, [t]);
  }
  const stageNums = [...byStage.keys()].sort((a, b) => a - b);
  const batches: Batch[] = [];
  for (const s of stageNums) {
    batches.push(...packStage(byStage.get(s)!, maxBatch, s, `s${s}`));
  }
  return { stages: stageNums.length, batches, cyclic };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost / throughput — composes pricing.callCost (caching + cliff) and
// usage.weighted (rate-limit burn). All assumed constants are injected.
// ─────────────────────────────────────────────────────────────────────────────

export type CostParams = {
  model?: string; // e.g. "claude-opus-4-8" → priced via pricing.ts
  coldContextTokens: number; // cacheable stable prefix (sys+tools+CLAUDE.md) — CALIBRATE
  fileTokens: (path: string) => number; // size-weighted context per file — CALIBRATE from disk
  descTokens?: number; // tokens to state one task in a turn (default 500)
  turnGapSeconds?: number; // est seconds between turns; > TTL ⇒ prefix re-cached. default 60
  cacheTtlSeconds?: number; // cache lifetime (default 300 = the 5-min TTL)
};

const zeroTotals = (): Totals => ({
  input: 0,
  cacheCreate: 0,
  cacheRead: 0,
  output: 0,
  messages: 0,
});

function addUsage(tot: Totals, u: Usage): void {
  tot.input += u.input;
  tot.cacheCreate += u.cacheCreate;
  tot.cacheRead += u.cacheRead;
  tot.output += u.output;
  tot.messages += 1;
}

export type CostResult = { usd: number; weighted: number; premiumTurns: number };

// A batch as a warm multi-turn session. Turn 0 writes the stable prefix + its
// files to cache (1.25×). Each later turn reads the GROWN cached prefix (cold +
// all prior files + all prior outputs) at 0.1× and writes only its new files —
// UNLESS the inter-turn gap exceeds the TTL, in which case the cache has expired
// and the whole prefix is re-paid as a fresh write (this is the TTL-conditional
// behaviour the prototype hand-waved; here it actively erodes the savings when
// turns are slow). pricing.callCost stamps the >200k cliff premium per turn.
export function batchCost(
  taskIds: string[],
  tasksById: Map<string, TaskNode>,
  p: CostParams
): CostResult {
  const desc = p.descTokens ?? 500;
  const ttl = p.cacheTtlSeconds ?? 300;
  const warm = (p.turnGapSeconds ?? 60) <= ttl;
  const seen = new Set<string>(); // files already in this session's cached prefix
  const tot = zeroTotals();
  let prefix = 0; // accumulated cached-prefix tokens
  let usd = 0;
  let premiumTurns = 0;

  taskIds.forEach((id, k) => {
    const t = tasksById.get(id);
    if (!t) return;
    let newFiles = 0;
    for (const f of new Set([...t.reads, ...t.writes])) {
      if (!seen.has(f)) {
        seen.add(f);
        newFiles += p.fileTokens(f);
      }
    }
    let u: Usage;
    if (k === 0) {
      u = {
        model: p.model,
        input: desc,
        cacheCreate: p.coldContextTokens + newFiles,
        cacheRead: 0,
        output: t.effort,
      };
      prefix = p.coldContextTokens + newFiles + t.effort;
    } else if (warm) {
      u = {
        model: p.model,
        input: desc,
        cacheCreate: newFiles, // add this turn's new files to the warm cache
        cacheRead: prefix, // re-read the grown prefix at 0.1×
        output: t.effort,
      };
      prefix += newFiles + t.effort;
    } else {
      // cache expired between turns → re-pay the whole prefix as a fresh write
      u = {
        model: p.model,
        input: desc,
        cacheCreate: prefix + newFiles,
        cacheRead: 0,
        output: t.effort,
      };
      prefix += newFiles + t.effort;
    }
    const c = callCost(u);
    usd += c.usd;
    if (c.premium) premiumTurns++;
    addUsage(tot, u);
  });

  return { usd, weighted: weighted(tot), premiumTurns };
}

// Solo baseline: each task is its own COLD session with no cross-task reuse.
// Conservatively priced with NO caching benefit (fresh input at 1×) so the
// baseline never flatters batching — if anything it understates solo cost.
export function soloCost(task: TaskNode, p: CostParams): CostResult {
  const desc = p.descTokens ?? 500;
  let files = 0;
  for (const f of new Set([...task.reads, ...task.writes])) files += p.fileTokens(f);
  const u: Usage = {
    model: p.model,
    input: desc + p.coldContextTokens + files,
    cacheCreate: 0,
    cacheRead: 0,
    output: task.effort,
  };
  const c = callCost(u);
  const tot = zeroTotals();
  addUsage(tot, u);
  return { usd: c.usd, weighted: weighted(tot), premiumTurns: c.premium ? 1 : 0 };
}

export type PlanSummary = {
  soloUSD: number;
  batchedUSD: number;
  savingsUSD: number;
  savingsPct: number; // 0..100
  soloWeighted: number; // rate-limit burn if done solo
  batchedWeighted: number; // rate-limit burn if batched
  throughputMultiplier: number; // soloWeighted / batchedWeighted (≥1 ⇒ more work/limit)
  premiumBatches: number; // batches with a turn past the 200k cliff
};

// Roll a Plan up into both KPIs. Dollars (for API/Enterprise tiers) and the
// throughput multiplier (for subscription tiers) are ALWAYS both computed; the
// caller decides which is the headline. The stateful "X tasks before reset"
// figure is layered on at the API/UI boundary by dividing the live remaining
// capacity from usage.getForecast() by batchedWeighted/taskCount — it needs
// process-time telemetry, so it does not belong in this pure module.
export function summarizePlan(
  plan: Plan,
  tasks: TaskNode[],
  p: CostParams
): PlanSummary {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let soloUSD = 0;
  let soloWeighted = 0;
  for (const t of tasks) {
    const c = soloCost(t, p);
    soloUSD += c.usd;
    soloWeighted += c.weighted;
  }
  let batchedUSD = 0;
  let batchedWeighted = 0;
  let premiumBatches = 0;
  for (const b of plan.batches) {
    const c = batchCost(b.taskIds, byId, p);
    batchedUSD += c.usd;
    batchedWeighted += c.weighted;
    if (c.premiumTurns > 0) premiumBatches++;
  }
  const savingsUSD = soloUSD - batchedUSD;
  return {
    soloUSD,
    batchedUSD,
    savingsUSD,
    savingsPct: soloUSD > 0 ? (savingsUSD / soloUSD) * 100 : 0,
    soloWeighted,
    batchedWeighted,
    throughputMultiplier: batchedWeighted > 0 ? soloWeighted / batchedWeighted : 1,
    premiumBatches,
  };
}

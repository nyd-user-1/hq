// THE FLEET DASHBOARD reader — the "monitor" half of the Fleet view (the "watch"
// half is the live roster, served by /api/terminal/repl/list). One scope-aware
// payload: a band of KPI scalars + four chart "shapes" (series / ranking /
// distribution), at either FLEET grain (everything, last 7–14d) or SESSION grain
// (one transcript). The shapes are a fixed vocabulary so a growing universe of
// metrics drops into an existing shape, never a new component. Everything here is
// real, read straight off disk via the existing lib readers — no synthetic data.
import { getUsageStates, getSpend, tokensByDay } from "@/lib/usage";
import { getSessions, type SessionInfo } from "@/lib/sessions";
import { getTodos } from "@/lib/todo";
import { timelineFor } from "@/lib/transcript";

const CONTEXT_LIMIT = 1_000_000; // the Opus 1M window; 200k = the price cliff
const CLIFF = 200_000;

// ── the shape vocabulary ─────────────────────────────────────────────────────
export type Stat = { label: string; value: string; sub?: string };
export type Shape =
  | { kind: "series"; title: string; points: number[]; capL: string; capR: string }
  | { kind: "ranking"; title: string; rows: { name: string; pct: number; value: string }[] }
  | { kind: "distribution"; title: string; bins: { h: number; hot: boolean }[]; xL: string; xR: string };

export type FleetMetrics = {
  scope: { level: "fleet" | "session"; id: string | null; label: string };
  kpis: Stat[];
  shapes: Shape[]; // exactly four cards
  generatedAt: number;
};

// ── format helpers (server-side, so the client just paints) ──────────────────
const fmtTok = (n: number): string =>
  n >= 1e9
    ? (n / 1e9).toFixed(1) + "B"
    : n >= 1e6
      ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M"
      : n >= 1e3
        ? Math.round(n / 1e3) + "k"
        : String(Math.round(n));
const fmtUsd = (n: number): string => "$" + (n >= 100 ? String(Math.round(n)) : n.toFixed(n >= 10 ? 1 : 2));
const fmtDur = (ms: number): string => {
  const s = ms / 1000;
  if (s < 60) return Math.round(s) + "s";
  const m = s / 60;
  if (m < 60) return Math.round(m) + "m";
  const h = m / 60;
  return h < 24 ? h.toFixed(1) + "h" : Math.round(h / 24) + "d";
};

// Bucket values into fixed thresholds → distribution bars (normalized 0..100,
// `hot` flags the over-threshold bins so the client can warm-tint them).
function bucket(values: number[], edges: number[], hotFrom: number): { h: number; hot: boolean }[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const v of values) {
    let i = edges.findIndex((e) => v < e);
    if (i === -1) i = edges.length;
    counts[i]++;
  }
  const max = Math.max(1, ...counts);
  return counts.map((c, i) => ({ h: Math.round((c / max) * 100), hot: i >= hotFrom }));
}

// ── FLEET grain — everything, this week ──────────────────────────────────────
function fleetScope(now: number): FleetMetrics {
  const states = getUsageStates();
  const week = states.meters.find((m) => m.key === "weekAll");
  const spend = getSpend();
  const set = getSessions(150); // recent working set — bounded, incremental-cached
  const active7d = set.filter((s) => now - s.lastActive < 7 * 864e5);
  const todos = getTodos();
  const pending = todos.filter((t) => !t.done).length;

  // ranking — weighted tokens by project (top 5)
  const byProject = new Map<string, number>();
  for (const s of set) byProject.set(s.project, (byProject.get(s.project) ?? 0) + s.weightedTokens);
  const ranked = [...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topTok = ranked[0]?.[1] || 1;

  // distribution — sessions by current context size, cliff at 200k
  const ctxBins = bucket(
    set.map((s) => s.contextTokens),
    [50_000, 100_000, CLIFF, 400_000],
    2, // bins at/after the 200k edge are "hot" (premium zone)
  );

  // model usage — the weekly weighted mix
  const modelRows = states.byModel
    .slice(0, 5)
    .map((m) => ({ name: m.tier, pct: Math.round(m.pct), value: Math.round(m.pct) + "%" }));

  const series = tokensByDay(14);

  return {
    scope: { level: "fleet", id: null, label: "all sessions · 14d" },
    kpis: [
      { label: "sessions", value: String(active7d.length), sub: `${set.length} recent` },
      { label: "tokens · wk", value: fmtTok(week?.rawTokens ?? 0), sub: fmtUsd(spend.week) + " spend" },
      { label: "turns · wk", value: String(week?.messages ?? 0) },
      { label: "projects", value: String(byProject.size) },
      { label: "todos", value: String(todos.length), sub: `${pending} pending` },
      { label: "ctx · over cliff", value: `${set.filter((s) => s.contextTokens > CLIFF).length}`, sub: "past 200k" },
    ],
    shapes: [
      { kind: "series", title: "Tokens / day", points: series.map((d) => d.weighted), capL: series[0]?.day ?? "", capR: "today" },
      {
        kind: "ranking",
        title: "Tokens by project",
        rows: ranked.map(([name, tok]) => ({ name, pct: Math.round((tok / topTok) * 100), value: fmtTok(tok) })),
      },
      { kind: "distribution", title: "Sessions by context · 200k cliff", bins: ctxBins, xL: "<50k", xR: "400k+" },
      { kind: "ranking", title: "Model usage · wk", rows: modelRows },
    ],
    generatedAt: now,
  };
}

// ── SESSION grain — one transcript ───────────────────────────────────────────
function sessionScope(id: string, now: number): FleetMetrics {
  const tl = timelineFor(id, 100_000, true);
  const turns = tl.items.filter((i): i is Extract<typeof i, { kind: "turn" }> => i.kind === "turn");
  const userN = turns.filter((t) => t.role === "user").length;
  const claudeN = turns.filter((t) => t.role === "assistant").length;
  const ctx = tl.contextTokens;
  const ctxLeft = Math.max(0, Math.round((1 - ctx / CONTEXT_LIMIT) * 100));

  // timestamps → session span + per-turn durations
  const stamps = turns.map((t) => Date.parse(t.at)).filter((n) => !Number.isNaN(n));
  const spanMs = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);

  // burn curve — the per-turn token SHAPE scaled so its endpoint is the session's
  // REAL context size. contextTokens is the only ground truth (cumulative
  // turnTokens ≠ context, since cache reads bloat the window), so we keep the
  // turnTokens shape but pin the end to ctx — that way the curve, the 200k-cliff
  // crossing, and the "ctx left" KPI never disagree. Linear ramp if no turnTokens.
  let cum = 0;
  const rawCum = turns.map((t) => (cum += t.turnTokens ?? 0));
  const total = rawCum[rawCum.length - 1] || 0;
  const burn =
    total > 0
      ? rawCum.map((v) => Math.round((v / total) * ctx))
      : turns.map((_, i) => Math.round((ctx * (i + 1)) / Math.max(1, turns.length)));
  const to200 = burn.findIndex((b) => b >= CLIFF);

  // tokens by turn — heaviest turns
  const heavy = turns
    .map((t, i) => ({ i, tok: t.turnTokens ?? 0 }))
    .filter((t) => t.tok > 0)
    .sort((a, b) => b.tok - a.tok)
    .slice(0, 6);
  const topTurn = heavy[0]?.tok || 1;

  // tools used — count by tool name
  const toolCounts = new Map<string, number>();
  for (const it of tl.items) if (it.kind === "tool") toolCounts.set(it.tool, (toolCounts.get(it.tool) ?? 0) + 1);
  const tools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topTool = tools[0]?.[1] || 1;

  const timeBins = bucket(gaps, [5_000, 15_000, 30_000, 60_000, 120_000, 300_000], 4);

  return {
    scope: { level: "session", id, label: `${tl.project} · ${id.slice(0, 8)}` },
    kpis: [
      { label: "turns", value: String(turns.length), sub: `${userN} you · ${claudeN} claude` },
      { label: "ctx left", value: `${ctxLeft}%`, sub: ctx > CLIFF ? "past cliff" : fmtTok(ctx) },
      { label: "tok / turn", value: fmtTok(claudeN ? ctx / claudeN : 0), sub: "avg" },
      { label: "to 200k", value: to200 >= 0 ? `turn ${to200 + 1}` : "—", sub: to200 >= 0 ? "" : "under cliff" },
      { label: "session", value: spanMs ? fmtDur(spanMs) : "—", sub: tl.model || "" },
      { label: "tools", value: String([...toolCounts.values()].reduce((a, b) => a + b, 0)), sub: `${toolCounts.size} kinds` },
    ],
    shapes: [
      { kind: "series", title: "Context burn · this session", points: burn, capL: "start", capR: fmtTok(ctx) },
      {
        kind: "ranking",
        title: "Tokens by turn · top",
        rows: heavy.map((t) => ({ name: `turn ${t.i + 1}`, pct: Math.round((t.tok / topTurn) * 100), value: fmtTok(t.tok) })),
      },
      { kind: "distribution", title: "Time per turn", bins: timeBins, xL: "<5s", xR: "5m+" },
      {
        kind: "ranking",
        title: "Tools used · this session",
        rows: tools.map(([name, n]) => ({ name, pct: Math.round((n / topTool) * 100), value: `${n}` })),
      },
    ],
    generatedAt: now,
  };
}

// Scope-aware entry point. `id` present ⇒ session grain; absent ⇒ fleet grain.
export function fleetMetrics(id: string | null): FleetMetrics {
  const now = Date.now();
  return id ? sessionScope(id, now) : fleetScope(now);
}

export type { SessionInfo };

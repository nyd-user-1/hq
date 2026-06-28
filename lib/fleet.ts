// THE FLEET DASHBOARD reader. A METRIC REGISTRY: a catalog of named metrics, each
// tagged with a chart SHAPE (stat / series / area / ranking / distribution /
// scatter / heatmap / …) and the scopes it supports (fleet = everything · session =
// one transcript). The board renders a user-chosen subset (drag from the kpi-panel
// library); this file computes the data for whatever ids it's asked for, at the
// requested scope. SCOPE = an optional project filter + a set of selected sessions
// (0 = all, 1 = session grain, >1 = a multi-session aggregate). Everything is real,
// read straight off disk via the existing lib readers — no synthetic data.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getUsageStates, getSpend, tokensByDay, tokensByDayByTier, perFileDayWeights } from "@/lib/usage";
import { getSessions, lifetimeByProject, tokensByDayByProject, sessionSpans, type SessionInfo } from "@/lib/sessions";
import { getTodos } from "@/lib/todo";
import { timelineFor } from "@/lib/transcript";

const CONTEXT_LIMIT = 1_000_000; // the Opus 1M window; 200k = the price cliff
const CLIFF = 200_000;
const HALF = CONTEXT_LIMIT / 2; // the "50% of window" mark
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const DAY_MS = 24 * 60 * 60 * 1000;

// ── the shape vocabulary ─────────────────────────────────────────────────────
export type Tone = "blue" | "orange" | "green" | "amber" | "red" | "zinc";
export type Stat = { label: string; value: string; sub?: string; tone?: Tone };
export type Shape =
  | { kind: "series"; title: string; points: number[]; capL: string; capR: string; labels?: string[]; tone?: Tone }
  | { kind: "area"; title: string; points: number[]; capL: string; capR: string; labels?: string[]; tone?: Tone }
  | { kind: "ranking"; title: string; rows: { name: string; pct: number; value: string }[]; tone?: Tone }
  | { kind: "distribution"; title: string; bins: { h: number; hot: boolean }[]; xL: string; xR: string; tone?: Tone }
  | { kind: "scatter"; title: string; pts: { x: number; y: number; label?: string }[]; xL: string; yL: string; tone?: Tone }
  | { kind: "heatmap"; title: string; grid: number[][]; rows: string[]; cols: string[]; tone?: Tone }
  | { kind: "stacked"; title: string; segs: { name: string; value: string; pct: number; tone?: Tone }[] }
  | { kind: "table"; title: string; cols: string[]; rows: string[][] }
  | { kind: "calendar"; title: string; cells: number[]; capL: string; capR: string; tone?: Tone }
  | { kind: "box"; title: string; min: number; q1: number; med: number; q3: number; max: number; fmt: "dur" | "num"; tone?: Tone }
  | { kind: "timeline"; title: string; items: { label: string; at: number }[]; startMs: number; endMs: number; capL: string; capR: string; tone?: Tone }
  | { kind: "stackedArea"; title: string; dayLabels: string[]; series: { name: string; tone?: Tone; points: number[] }[]; capL: string; capR: string }
  | { kind: "sparkline"; title: string; rows: { name: string; points: number[]; value: string }[] }
  | { kind: "gantt"; title: string; items: { label: string; startPct: number; widthPct: number; tone?: Tone }[]; capL: string; capR: string };

// Full kind superset — the catalog labels cards by these; renderers exist for the
// implemented ones, the rest are reserved for the chart-zoo expansion.
export type MetricKind =
  | "stat" | "series" | "area" | "ranking" | "distribution" | "histogram"
  | "scatter" | "heatmap" | "stacked" | "stackedArea" | "table" | "timeline"
  | "calendar" | "box" | "sparkline" | "gantt";

export type MetricScope = "fleet" | "session";

export type MetricDef = {
  id: string;
  label: string;
  group: string;
  kind: MetricKind;
  scopes: MetricScope[];
  desc?: string;
};

export type MetricItem = {
  id: string;
  label: string;
  kind: MetricKind;
  stat?: Stat;
  shape?: Shape;
};

export type FleetMetrics = {
  scope: { level: "fleet" | "session"; id: string | null; label: string; project: string | null; sessions: string[] };
  items: MetricItem[];
  catalog: MetricDef[];
  projects: string[]; // for the projects picker
  generatedAt: number;
};

// ── format helpers ───────────────────────────────────────────────────────────
const fmtTok = (n: number): string =>
  n >= 1e9 ? (n / 1e9).toFixed(1) + "B"
    : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M"
      : n >= 1e3 ? Math.round(n / 1e3) + "k"
        : String(Math.round(n));
const fmtUsd = (n: number): string => "$" + (n >= 100 ? String(Math.round(n)) : n.toFixed(n >= 10 ? 1 : 2));
const fmtUsdK = (n: number): string => (n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : fmtUsd(n));
const fmtDur = (ms: number): string => {
  const s = ms / 1000;
  if (s < 60) return Math.round(s) + "s";
  const m = s / 60;
  if (m < 60) return Math.round(m) + "m";
  const h = m / 60;
  return h < 24 ? h.toFixed(1) + "h" : Math.round(h / 24) + "d";
};

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

const ranking = (title: string, rows: { name: string; pct: number; value: string }[], tone?: Tone): Shape => ({ kind: "ranking", title, rows, tone });
const series = (title: string, points: number[], capL: string, capR: string, tone?: Tone, labels?: string[]): Shape => ({ kind: "series", title, points, capL, capR, tone, labels });
const area = (title: string, points: number[], capL: string, capR: string, tone?: Tone, labels?: string[]): Shape => ({ kind: "area", title, points, capL, capR, tone, labels });

function sessionMtimes(): number[] {
  const out: number[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const st = fs.statSync(path.join(dirPath, f));
        if (st.size > 0) out.push(st.mtimeMs);
      } catch {
        /* vanished */
      }
    }
  }
  return out;
}

function idleCount(sub: string, days: number): { idle: number; total: number } {
  const root = path.join(os.homedir(), ".claude", sub);
  const cutoff = Date.now() - days * DAY_MS;
  let idle = 0;
  let total = 0;
  try {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      total++;
      try {
        if (fs.statSync(path.join(root, d.name)).mtimeMs < cutoff) idle++;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no dir */
  }
  return { idle, total };
}

// ── fleet context ────────────────────────────────────────────────────────────
type FleetCtx = ReturnType<typeof fleetCtx>;
function fleetCtx(project: string | null) {
  const now = Date.now();
  const states = getUsageStates();
  const week = states.meters.find((m) => m.key === "weekAll");
  const spend = getSpend();
  const allSet = getSessions(150);
  // project filter: the set-derived metrics scope to one project when chosen.
  const set = project ? allSet.filter((s) => s.project === project) : allSet;
  const active7d = set.filter((s) => now - s.lastActive < 7 * DAY_MS);
  const todos = getTodos();
  const life = lifetimeByProject();

  const dayTok = tokensByDay(14);
  const dayTok56 = tokensByDay(56);
  const weekTok: number[] = [];
  for (let w = 0; w < 8; w++) {
    let sum = 0;
    for (let d = 0; d < 7; d++) sum += dayTok56[w * 7 + d]?.weighted ?? 0;
    weekTok.push(sum);
  }

  const mtimes = sessionMtimes();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const day0 = dayStart.getTime() - 13 * DAY_MS;
  const week0 = dayStart.getTime() - 55 * DAY_MS;
  const sessDay = new Array<number>(14).fill(0);
  const sessWeek = new Array<number>(8).fill(0);
  const cal = new Array<number>(35).fill(0); // last 5 weeks, for the calendar
  const cal0 = dayStart.getTime() - 34 * DAY_MS;
  // activity heatmap — weekday (0=Sun) × hour (0..23)
  const heat: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const t of mtimes) {
    const di = Math.floor((t - day0) / DAY_MS);
    if (di >= 0 && di < 14) sessDay[di]++;
    const wi = Math.floor((t - week0) / (7 * DAY_MS));
    if (wi >= 0 && wi < 8) sessWeek[wi]++;
    const ci = Math.floor((t - cal0) / DAY_MS);
    if (ci >= 0 && ci < 35) cal[ci]++;
    const d = new Date(t);
    heat[d.getDay()][d.getHours()]++;
  }

  return { now, states, week, spend, set, active7d, todos, life, dayTok, weekTok, sessDay, sessWeek, heat, cal };
}

// ── session context ──────────────────────────────────────────────────────────
type SessionCtx = ReturnType<typeof sessionCtx>;
function sessionCtx(id: string) {
  const tl = timelineFor(id, 100_000, true);
  const turns = tl.items.filter((i): i is Extract<typeof i, { kind: "turn" }> => i.kind === "turn");
  const userN = turns.filter((t) => t.role === "user").length;
  const claudeN = turns.filter((t) => t.role === "assistant").length;
  const ctx = tl.contextTokens;
  const ctxLeft = Math.max(0, Math.round((1 - ctx / CONTEXT_LIMIT) * 100));

  const stamps = turns.map((t) => Date.parse(t.at)).filter((n) => !Number.isNaN(n));
  const spanMs = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);

  let cum = 0;
  const rawCum = turns.map((t) => (cum += t.turnTokens ?? 0));
  const total = rawCum[rawCum.length - 1] || 0;
  const burn =
    total > 0
      ? rawCum.map((v) => Math.round((v / total) * ctx))
      : turns.map((_, i) => Math.round((ctx * (i + 1)) / Math.max(1, turns.length)));
  const to200 = burn.findIndex((b) => b >= CLIFF);
  const turnsAbove200 = burn.filter((b) => b >= CLIFF).length;
  const timeTo200 = to200 >= 0 && stamps.length > to200 ? stamps[to200] - stamps[0] : -1;
  const preloaded = burn[0] ?? 0;

  const heavy = turns
    .map((t, i) => ({ i, tok: t.turnTokens ?? 0 }))
    .filter((t) => t.tok > 0)
    .sort((a, b) => b.tok - a.tok)
    .slice(0, 6);

  const toolCounts = new Map<string, number>();
  for (const it of tl.items) if (it.kind === "tool") toolCounts.set(it.tool, (toolCounts.get(it.tool) ?? 0) + 1);
  const tools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return { tl, turns, userN, claudeN, ctx, ctxLeft, spanMs, gaps, burn, to200, turnsAbove200, timeTo200, preloaded, heavy, tools, toolCounts };
}

// ── the registry ─────────────────────────────────────────────────────────────
type Compute = {
  def: MetricDef;
  fleet?: (c: FleetCtx) => Stat | Shape;
  session?: (c: SessionCtx, id: string) => Stat | Shape;
};

const ctxTone = (left: number): Tone => (left > 25 ? "green" : left > 10 ? "amber" : "red");

const REGISTRY: Compute[] = [
  // ── Overview ──
  { def: { id: "f_sessions", label: "Sessions", group: "Overview", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "sessions", value: String(c.active7d.length), sub: "recent", tone: "green" }) },
  { def: { id: "f_tokens", label: "Tokens · week", group: "Overview", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "tokens", value: fmtTok(c.week?.rawTokens ?? 0), sub: fmtUsdK(c.spend.week) + " wk", tone: "blue" }) },
  { def: { id: "f_turns", label: "Turns · week", group: "Overview", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "turns", value: String(c.week?.messages ?? 0), sub: "wk" }) },
  { def: { id: "f_projects", label: "Projects", group: "Overview", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "projects", value: String(c.life.length), sub: "all-time" }) },
  { def: { id: "f_spend", label: "Spend · week", group: "Overview", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "spend", value: fmtUsdK(c.spend.week), sub: fmtUsd(c.spend.today) + " today", tone: "orange" }) },
  { def: { id: "f_cliff", label: "Past 200k cliff", group: "Overview", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "ctx cliff", value: String(c.set.filter((s) => s.contextTokens > CLIFF).length), sub: "past 200k", tone: "amber" }) },

  // ── Tokens ──
  { def: { id: "tokens_day", label: "Tokens / day", group: "Tokens", kind: "series", scopes: ["fleet"] }, fleet: (c) => series("Tokens / day", c.dayTok.map((d) => d.weighted), c.dayTok[0]?.day ?? "", "today", "blue", c.dayTok.map((d) => d.day)) },
  { def: { id: "tokens_day_area", label: "Tokens / day (area)", group: "Tokens", kind: "area", scopes: ["fleet"] }, fleet: (c) => area("Tokens / day", c.dayTok.map((d) => d.weighted), c.dayTok[0]?.day ?? "", "today", "blue", c.dayTok.map((d) => d.day)) },
  { def: { id: "tokens_week", label: "Tokens / week", group: "Tokens", kind: "series", scopes: ["fleet"] }, fleet: (c) => series("Tokens / week · 8wk", c.weekTok, "8wk ago", "this wk", "blue") },
  { def: { id: "tokens_by_project", label: "Tokens by project", group: "Tokens", kind: "ranking", scopes: ["fleet"] }, fleet: (c) => { const top = c.life.slice(0, 10); const max = top[0]?.weighted || 1; return ranking("Tokens by project · all-time", top.map((p) => ({ name: p.project, pct: Math.round((p.weighted / max) * 100), value: fmtTok(p.weighted) })), "blue"); } },
  { def: { id: "tokens_per_session", label: "Tokens by session", group: "Tokens", kind: "ranking", scopes: ["fleet"] }, fleet: (c) => { const top = [...c.set].sort((a, b) => b.weightedTokens - a.weightedTokens).slice(0, 10); const max = top[0]?.weightedTokens || 1; return ranking("Tokens by session · top", top.map((s) => ({ name: s.id.slice(0, 8), pct: Math.round((s.weightedTokens / max) * 100), value: fmtTok(s.weightedTokens) })), "blue"); } },

  // ── Sessions ──
  { def: { id: "sessions_day", label: "Sessions / day", group: "Sessions", kind: "series", scopes: ["fleet"] }, fleet: (c) => series("Sessions / day · 14d", c.sessDay, "14d ago", "today", "green") },
  { def: { id: "sessions_week", label: "Sessions / week", group: "Sessions", kind: "series", scopes: ["fleet"] }, fleet: (c) => series("Sessions / week · 8wk", c.sessWeek, "8wk ago", "this wk", "green") },
  { def: { id: "sessions_by_context", label: "Sessions by context", group: "Sessions", kind: "distribution", scopes: ["fleet"] }, fleet: (c) => ({ kind: "distribution", title: "Sessions by context · 200k cliff", bins: bucket(c.set.map((s) => s.contextTokens), [50_000, 100_000, CLIFF, 400_000], 2), xL: "<50k", xR: "400k+", tone: "blue" }) },
  { def: { id: "sessions_per_project", label: "Sessions by project", group: "Sessions", kind: "ranking", scopes: ["fleet"] }, fleet: (c) => { const top = [...c.life].sort((a, b) => b.sessions - a.sessions).slice(0, 10); const max = top[0]?.sessions || 1; return ranking("Sessions by project · all-time", top.map((p) => ({ name: p.project, pct: Math.round((p.sessions / max) * 100), value: String(p.sessions) })), "green"); } },
  { def: { id: "turns_vs_tokens", label: "Turns × tokens", group: "Sessions", kind: "scatter", scopes: ["fleet"] }, fleet: (c) => ({ kind: "scatter", title: "Turns × tokens · per session", pts: c.set.slice(0, 120).map((s) => ({ x: s.messages, y: s.weightedTokens, label: s.id.slice(0, 8) })), xL: "turns", yL: "tokens", tone: "blue" }) },
  { def: { id: "activity_heatmap", label: "Activity heatmap", group: "Sessions", kind: "heatmap", scopes: ["fleet"] }, fleet: (c) => ({ kind: "heatmap", title: "Activity · weekday × hour", grid: c.heat, rows: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], cols: Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? String(h) : "")), tone: "blue" }) },
  { def: { id: "model_usage", label: "Model usage", group: "Sessions", kind: "ranking", scopes: ["fleet", "session"] }, fleet: (c) => ranking("Model usage · wk", c.states.byModel.slice(0, 5).map((m) => ({ name: m.tier, pct: Math.round(m.pct), value: Math.round(m.pct) + "%" })), "orange"), session: (c) => ranking("Model · this session", [{ name: c.tl.model || "—", pct: 100, value: "100%" }], "orange") },

  // ── Session detail ──
  { def: { id: "s_turns", label: "Turns", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "turns", value: String(c.turns.length), sub: `${c.userN} you · ${c.claudeN} claude` }) },
  { def: { id: "s_user", label: "User inputs", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "user inputs", value: String(c.userN), sub: "you" }) },
  { def: { id: "s_claude", label: "Claude outputs", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "claude outputs", value: String(c.claudeN), sub: "replies" }) },
  { def: { id: "s_ctx_left", label: "Context left", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "ctx left", value: `${c.ctxLeft}%`, sub: c.ctx > CLIFF ? "past cliff" : fmtTok(c.ctx), tone: ctxTone(c.ctxLeft) }) },
  { def: { id: "s_tok_per_turn", label: "Tokens / turn", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "tok / turn", value: fmtTok(c.claudeN ? c.ctx / c.claudeN : 0), sub: "avg" }) },
  { def: { id: "s_total_time", label: "Total session time", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "session", value: c.spanMs ? fmtDur(c.spanMs) : "—", sub: c.tl.model || "" }) },
  { def: { id: "s_to200_turn", label: "Turns to 200k", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "to 200k", value: c.to200 >= 0 ? `turn ${c.to200 + 1}` : "—", sub: c.to200 >= 0 ? "" : "under cliff", tone: c.to200 >= 0 ? "amber" : "zinc" }) },
  { def: { id: "s_time_to_200", label: "Time to 200k", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "time to 200k", value: c.timeTo200 >= 0 ? fmtDur(c.timeTo200) : "—", sub: c.timeTo200 >= 0 ? "" : "under cliff", tone: c.timeTo200 >= 0 ? "amber" : "zinc" }) },
  { def: { id: "s_turns_above_200", label: "Turns above 200k", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "turns >200k", value: String(c.turnsAbove200), sub: "premium zone", tone: c.turnsAbove200 ? "amber" : "zinc" }) },
  { def: { id: "s_ctx_50", label: "Context vs 50%", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "ctx vs 50%", value: fmtTok(c.ctx), sub: c.ctx > HALF ? "above 50%" : "below 50%", tone: c.ctx > HALF ? "amber" : "green" }) },
  { def: { id: "s_preloaded", label: "Pre-loaded context", group: "Session", kind: "stat", scopes: ["session"] }, session: (c) => ({ label: "preloaded ctx", value: fmtTok(c.preloaded), sub: "turn 1 cold load" }) },
  { def: { id: "context_burn", label: "Context burn", group: "Session", kind: "area", scopes: ["session"] }, session: (c) => area("Context burn · this session", c.burn, "start", fmtTok(c.ctx), "orange") },
  { def: { id: "tokens_by_turn", label: "Tokens by turn", group: "Session", kind: "ranking", scopes: ["session"] }, session: (c) => { const max = c.heavy[0]?.tok || 1; return ranking("Tokens by turn · top", c.heavy.map((t) => ({ name: `turn ${t.i + 1}`, pct: Math.round((t.tok / max) * 100), value: fmtTok(t.tok) })), "blue"); } },
  { def: { id: "time_per_turn", label: "Time per turn", group: "Session", kind: "distribution", scopes: ["session"] }, session: (c) => ({ kind: "distribution", title: "Time per turn", bins: bucket(c.gaps, [5_000, 15_000, 30_000, 60_000, 120_000, 300_000], 4), xL: "<5s", xR: "5m+", tone: "blue" }) },
  { def: { id: "tools_used", label: "Tools used", group: "Session", kind: "ranking", scopes: ["session"] }, session: (c) => { const max = c.tools[0]?.[1] || 1; return ranking("Tools used · this session", c.tools.map(([name, n]) => ({ name, pct: Math.round((n / max) * 100), value: String(n) })), "blue"); } },

  // ── chart-zoo: composition / tabular / temporal / spread ──
  { def: { id: "model_mix_stacked", label: "Model mix (stacked)", group: "Sessions", kind: "stacked", scopes: ["fleet"] }, fleet: (c) => ({ kind: "stacked", title: "Model mix · wk", segs: c.states.byModel.slice(0, 6).map((m, i) => ({ name: m.tier, value: Math.round(m.pct) + "%", pct: m.pct, tone: (["orange", "blue", "green", "amber", "red", "zinc"] as Tone[])[i] })) }) },
  { def: { id: "top_sessions_table", label: "Top sessions (table)", group: "Sessions", kind: "table", scopes: ["fleet"] }, fleet: (c) => ({ kind: "table", title: "Top sessions", cols: ["session", "project", "turns", "tokens"], rows: [...c.set].sort((a, b) => b.weightedTokens - a.weightedTokens).slice(0, 8).map((s) => [s.id.slice(0, 8), s.project, String(s.messages), fmtTok(s.weightedTokens)]) }) },
  { def: { id: "sessions_calendar", label: "Sessions calendar", group: "Sessions", kind: "calendar", scopes: ["fleet"] }, fleet: (c) => ({ kind: "calendar", title: "Sessions · last 5 weeks", cells: c.cal, capL: "5wk ago", capR: "today", tone: "green" }) },
  { def: { id: "sessions_timeline", label: "Sessions timeline", group: "Sessions", kind: "timeline", scopes: ["fleet"] }, fleet: (c) => { const end = c.now, start = end - 14 * DAY_MS; return { kind: "timeline", title: "Sessions · 14d", items: c.set.filter((s) => s.lastActive >= start).slice(0, 40).map((s) => ({ label: `${s.project} ${s.id.slice(0, 6)}`, at: s.lastActive })), startMs: start, endMs: end, capL: "14d ago", capR: "now", tone: "blue" }; } },
  { def: { id: "turn_time_box", label: "Turn time (box)", group: "Session", kind: "box", scopes: ["session"] }, session: (c) => { const g = [...c.gaps].sort((a, b) => a - b); const q = (p: number) => (g.length ? g[Math.min(g.length - 1, Math.floor(p * (g.length - 1)))] : 0); return { kind: "box", title: "Turn time · quartiles", min: q(0), q1: q(0.25), med: q(0.5), q3: q(0.75), max: q(1), fmt: "dur", tone: "blue" }; } },
  { def: { id: "ctx_burndown", label: "Context burn-down", group: "Session", kind: "area", scopes: ["session"] }, session: (c) => area("Burn-down to 200k cliff", c.burn.map((b) => Math.max(0, CLIFF - b)), "start", "cliff", "amber") },
  { def: { id: "tokens_stacked_area", label: "Tokens by model (area)", group: "Tokens", kind: "stackedArea", scopes: ["fleet"] }, fleet: () => { const { dayLabels, series } = tokensByDayByTier(14); const tones: Record<string, Tone> = { Opus: "orange", Sonnet: "blue", Haiku: "green", Fable: "red", Mythos: "amber", Other: "zinc" }; return { kind: "stackedArea", title: "Tokens by model · 14d", dayLabels, capL: dayLabels[0] ?? "", capR: "today", series: series.map((s) => ({ name: s.tier, tone: tones[s.tier] ?? "zinc", points: s.points })) }; } },
  { def: { id: "tokens_by_project_area", label: "Tokens by project (area)", group: "Tokens", kind: "stackedArea", scopes: ["fleet"] }, fleet: () => { const { dayLabels, rows } = tokensByDayByProject(14); const palette: Tone[] = ["orange", "blue", "green", "amber", "red", "zinc"]; return { kind: "stackedArea", title: "Tokens by project · 14d", dayLabels, capL: dayLabels[0] ?? "", capR: "today", series: rows.slice(0, 5).map((p, i) => ({ name: p.project, tone: palette[i % palette.length], points: p.points })) }; } },
  { def: { id: "tokens_by_session_area", label: "Tokens by session (area)", group: "Tokens", kind: "stackedArea", scopes: ["fleet"] }, fleet: () => { const { dayLabels, byFile } = perFileDayWeights(14); const palette: Tone[] = ["blue", "orange", "green", "amber", "red", "zinc"]; const top = [...byFile.entries()].map(([file, points]) => ({ id: path.basename(file, ".jsonl"), points, total: points.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total).slice(0, 5); return { kind: "stackedArea", title: "Tokens by session · 14d", dayLabels, capL: dayLabels[0] ?? "", capR: "today", series: top.map((e, i) => ({ name: e.id.slice(0, 8), tone: palette[i % palette.length], points: e.points })) }; } },
  { def: { id: "tokens_sparklines", label: "Project trends (sparkline)", group: "Tokens", kind: "sparkline", scopes: ["fleet"] }, fleet: () => { const { rows } = tokensByDayByProject(14); return { kind: "sparkline", title: "Project trends · 14d", rows: rows.slice(0, 8).map((p) => ({ name: p.project, points: p.points, value: fmtTok(p.total) })) }; } },
  { def: { id: "sessions_gantt", label: "Sessions (gantt)", group: "Sessions", kind: "gantt", scopes: ["fleet"] }, fleet: (c) => { const end = c.now, start = end - 14 * DAY_MS, span = Math.max(1, end - start); const spans = sessionSpans(40).filter((s) => s.end >= start); return { kind: "gantt", title: "Sessions · 14d spans", capL: "14d ago", capR: "now", items: spans.slice(0, 30).map((s) => { const a = Math.max(start, s.start), b = Math.min(end, s.end); return { label: `${s.project} ${s.id.slice(0, 6)}`, startPct: ((a - start) / span) * 100, widthPct: Math.max(0.6, ((b - a) / span) * 100) }; }) }; } },

  // ── Todos ──
  { def: { id: "todos_total", label: "Todos · total", group: "Todos", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "todos", value: String(c.todos.length), sub: "total" }) },
  { def: { id: "todos_pending", label: "Todos · pending", group: "Todos", kind: "stat", scopes: ["fleet"] }, fleet: (c) => { const p = c.todos.filter((t) => !t.done).length; return { label: "todos", value: String(p), sub: "pending", tone: p ? "amber" : "zinc" }; } },
  { def: { id: "todos_done", label: "Todos · completed", group: "Todos", kind: "stat", scopes: ["fleet"] }, fleet: (c) => ({ label: "todos done", value: String(c.todos.filter((t) => t.done).length), sub: "completed", tone: "green" }) },
  { def: { id: "todos_avg_age", label: "Todos · avg age", group: "Todos", kind: "stat", scopes: ["fleet"] }, fleet: (c) => { const pend = c.todos.filter((t) => !t.done && t.createdAt); const avg = pend.length ? pend.reduce((a, t) => a + (c.now - t.createdAt), 0) / pend.length : 0; return { label: "todo avg age", value: avg ? fmtDur(avg) : "—", sub: "pending" }; } },

  // ── Hygiene ──
  { def: { id: "skills_idle", label: "Skills idle >30d", group: "Hygiene", kind: "stat", scopes: ["fleet"] }, fleet: () => { const { idle, total } = idleCount("skills", 30); return { label: "skills idle", value: String(idle), sub: `of ${total} · >30d`, tone: idle ? "amber" : "zinc" }; } },
  { def: { id: "plugins_idle", label: "Plugins idle >30d", group: "Hygiene", kind: "stat", scopes: ["fleet"] }, fleet: () => { const { idle, total } = idleCount(path.join("plugins", "cache"), 30); return { label: "plugins idle", value: String(idle), sub: `of ${total} · >30d`, tone: idle ? "amber" : "zinc" }; } },
];

const BY_ID = new Map(REGISTRY.map((r) => [r.def.id, r]));
export const METRIC_CATALOG: MetricDef[] = REGISTRY.map((r) => r.def);

export const DEFAULT_METRICS: string[] = [
  "f_sessions", "f_tokens", "f_turns", "f_projects", "todos_pending", "f_cliff",
  "tokens_day", "tokens_by_project", "sessions_by_context", "model_usage",
];

const na = (def: MetricDef, why: string): MetricItem =>
  def.kind === "stat"
    ? { id: def.id, label: def.label, kind: "stat", stat: { label: def.label.toLowerCase(), value: "—", sub: why, tone: "zinc" } }
    : { id: def.id, label: def.label, kind: def.kind, shape: ranking(def.label, []) as Shape };

function pack(def: MetricDef, payload: Stat | Shape): MetricItem {
  return def.kind === "stat"
    ? { id: def.id, label: def.label, kind: "stat", stat: payload as Stat }
    : { id: def.id, label: def.label, kind: def.kind, shape: payload as Shape };
}

// ── scope-aware entry point ──────────────────────────────────────────────────
export function fleetMetrics(opts: { project?: string | null; sessions?: string[]; ids?: string[] } = {}): FleetMetrics {
  const now = Date.now();
  const project = opts.project ?? null;
  const sessions = (opts.sessions ?? []).filter(Boolean);
  const single = sessions.length === 1 ? sessions[0] : null; // session grain only with exactly one
  const want = (opts.ids && opts.ids.length ? opts.ids : DEFAULT_METRICS).filter((m) => BY_ID.has(m));

  const needFleet = want.some((m) => {
    const r = BY_ID.get(m)!;
    return !(single && r.session);
  });
  const fc = needFleet ? fleetCtx(project) : null;
  let sc: SessionCtx | null = null;
  if (single) {
    try {
      sc = sessionCtx(single);
    } catch {
      sc = null;
    }
  }

  const items: MetricItem[] = want.map((m) => {
    const r = BY_ID.get(m)!;
    if (single && r.session && sc) return pack(r.def, r.session(sc, single));
    if (r.fleet && fc) return pack(r.def, r.fleet(fc));
    if (single && r.session && !sc) return na(r.def, "no transcript");
    return na(r.def, single ? "fleet only" : "pick one session");
  });

  // project list for the picker — lifetime project names, biggest first
  const projects = lifetimeByProject().map((p) => p.project);

  let level: "fleet" | "session" = "fleet";
  let label = project ? project : "all projects";
  if (single && sc) {
    level = "session";
    label = `${sc.tl.project} · ${single.slice(0, 8)}`;
  } else if (sessions.length > 1) {
    label = `${sessions.length} sessions`;
  }

  return { scope: { level, id: single, label, project, sessions }, items, catalog: METRIC_CATALOG, projects, generatedAt: now };
}

export type { SessionInfo };

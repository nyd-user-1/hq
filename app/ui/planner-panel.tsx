"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePlanner } from "@/app/ui/planner-state";
import type { PlannerView } from "@/lib/planner";

// The Batch Planner — a live BURN CONSOLE. HQ panel chrome (AppPanel + Boundary
// chip) wraps a warm mission-control interior: a counting hero that ticks DOWN as
// the window burns (20s poll), a meaningful reset-window gauge (resets-in + how
// many plan-runs fit), un-batched-vs-batched cost bars, and session-card-grade
// batch cards you DRAG into a terminal (or copy the run prompt) to execute.
// One accent — orange (HQ's Claude color). GET /api/planner, PATCH config, POST
// /api/todo/evaluate. The terminal drop handler reads these DND types:
const DND_TODO = "application/x-hq-todo";

const TIERS: { key: string; label: string; suffix: string }[] = [
  { key: "basic", label: "Basic", suffix: "subscription" },
  { key: "pro", label: "Pro", suffix: "subscription" },
  { key: "max", label: "Max", suffix: "subscription" },
  { key: "team", label: "Team", suffix: "$/token" },
  { key: "enterprise", label: "Enterprise", suffix: "$/token" },
];

const usd = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : `${Math.round(n)}`);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const signedUsd = (n: number) => `${n < 0 ? "−" : "+"}${usd(Math.abs(n))}`;
const fmtDur = (ms: number) => {
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
};

const LABEL = "font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500";
const ACCENT = "text-orange-400";

// Number that eases from its previous value to the new one — counts up on first
// paint and down as the live poll lowers the target.
function HeroNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

function Ticks({ pct, count = 34, lit }: { pct: number; count?: number; lit: boolean }) {
  const fill = Math.round(Math.max(0, Math.min(1, pct)) * count);
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: count }).map((_, i) => {
        const on = i < fill;
        return (
          <div
            key={i}
            className={`h-3.5 flex-1 rounded-[1px] transition-colors duration-500 ${
              on ? "bg-orange-500" : "bg-zinc-800"
            }`}
            style={
              on && lit
                ? { animation: "pl-tick .35s ease both", animationDelay: `${i * 11}ms` }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

function Bar({
  label,
  value,
  pct,
  accent,
  lit,
}: {
  label: string;
  value: string;
  pct: number;
  accent?: boolean;
  lit: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-zinc-800/50">
        <div
          className={`h-full origin-left rounded-sm transition-transform duration-700 ease-out ${
            accent ? "bg-orange-500" : "bg-zinc-600"
          }`}
          style={{ transform: `scaleX(${lit ? Math.max(0, Math.min(1, pct)) : 0})` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-zinc-300">{value}</span>
    </div>
  );
}

export default function PlannerPanel() {
  const { open, setOpen } = usePlanner();
  const [view, setView] = useState<PlannerView | null>(null);
  const [loading, setLoading] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [lit, setLit] = useState(false);
  const [openBatch, setOpenBatch] = useState<string | null>(null); // bullets dropdown
  const [filesBatch, setFilesBatch] = useState<string | null>(null); // files dropdown
  const [copied, setCopied] = useState<string | null>(null);
  const viewRef = useRef<PlannerView | null>(null);
  const [delta, setDelta] = useState<{
    graphed: number;
    batches: number;
    stages: number;
    savingsP50: number;
    tasksLeft: number;
    changed: boolean;
  } | null>(null);

  // Apply a view. silent (live poll) updates numbers only — no diff flash, no
  // synced-stamp churn, no spinner — so the hero ticks down quietly.
  const applyView = useCallback((next: PlannerView, silent = false) => {
    if (!silent) {
      const prev = viewRef.current;
      if (prev && !prev.needsTier && !next.needsTier) {
        const d = {
          graphed: next.evaluatedCount - prev.evaluatedCount,
          batches: next.batches.length - prev.batches.length,
          stages: next.plan.stages - prev.plan.stages,
          savingsP50: next.dollars.savingsP50 - prev.dollars.savingsP50,
          tasksLeft: next.throughput.tasksLeftBatched - prev.throughput.tasksLeftBatched,
        };
        setDelta({
          ...d,
          changed:
            d.graphed !== 0 ||
            d.batches !== 0 ||
            d.stages !== 0 ||
            d.tasksLeft !== 0 ||
            Math.abs(d.savingsP50) >= 0.005,
        });
      } else {
        setDelta(null);
      }
      setSyncedAt(Date.now());
    }
    viewRef.current = next;
    setView(next);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setErr(null);
      }
      try {
        const r = await fetch("/api/planner", { cache: "no-store" });
        if (!r.ok) throw new Error(await r.text());
        applyView(await r.json(), silent);
      } catch (e) {
        if (!silent) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyView]
  );

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch("/api/planner", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await r.text());
        applyView(await r.json());
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [applyView]
  );

  const evaluate = useCallback(async () => {
    setEvaluating(true);
    setErr(null);
    try {
      const r = await fetch("/api/todo/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(await r.text());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEvaluating(false);
    }
  }, [load]);

  useEffect(() => {
    if (open) {
      load();
      setLit(false);
      const t = setTimeout(() => setLit(true), 40);
      return () => clearTimeout(t);
    }
    setLit(false);
  }, [open, load]);

  // Live: re-pull every 20s while open so "tasks before reset" ticks down as the
  // window burns. Silent — only the numbers move.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      if (!evaluating) load(true);
    }, 20000);
    return () => clearInterval(id);
  }, [open, evaluating, load]);

  const titleOf = useMemo(() => {
    const m = new Map((view?.tasks ?? []).map((t) => [t.id, t.title]));
    return (id: string) => m.get(id) ?? id;
  }, [view]);

  // 1-indexed batch number WITHIN each stage (so it reads "Stage 1 · Batch 1/2…",
  // not a cryptic global "S0").
  const batchNum = useMemo(() => {
    const counts: Record<number, number> = {};
    const m = new Map<string, number>();
    for (const b of view?.batches ?? []) {
      counts[b.stage] = (counts[b.stage] ?? 0) + 1;
      m.set(b.id, counts[b.stage]);
    }
    return m;
  }, [view]);

  const runPrompt = useCallback(
    (b: PlannerView["batches"][number]) => {
      const lines = b.taskIds.map((id) => `- ${titleOf(id)} (${id})`).join("\n");
      const files = b.files.length
        ? `\n\nShared files: ${b.files.map((f) => f.copy).join(", ")}`
        : "";
      return `Work these to-dos together in one warm session (batched for shared context):\n${lines}${files}`;
    },
    [titleOf]
  );

  const copyPrompt = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
  }, []);

  const isApi = view?.config.tier === "team" || view?.config.tier === "enterprise";
  const throughputHero = view?.headline === "throughput";
  const maxCost = view ? Math.max(view.dollars.soloP50, view.dollars.batchedP50, 0.0001) : 1;

  return (
    <AppPanel rootId="planner-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary label="planner-panel.tsx">
        <style>{`
          @keyframes pl-tick { from { opacity: 0; transform: scaleY(.3) } to { opacity: 1; transform: none } }
          @keyframes pl-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
          @keyframes pl-flash { 0% { background: rgba(249,115,22,.20) } 100% { background: transparent } }
        `}</style>

        {err && (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {!view ? (
          <p className="font-mono text-[10px] text-zinc-600">{loading ? "loading…" : "—"}</p>
        ) : view.needsTier ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed text-zinc-400">
              What&apos;s your plan? It sets which KPI leads — throughput
              (subscription) or dollars (pay-per-token). Both are always computed.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {TIERS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => patch({ tier: t.key })}
                  className="flex items-baseline gap-1.5 rounded-md border border-zinc-800 px-2.5 py-2 text-left transition-colors hover:border-orange-500/50 hover:bg-orange-500/[0.06]"
                >
                  <span className="text-xs text-zinc-200">{t.label}</span>
                  <span className="font-mono text-[9px] text-zinc-600">{t.suffix}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto">
            {/* ── STATUS BAR ── */}
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  onClick={evaluate}
                  disabled={evaluating}
                  className="shrink-0 cursor-pointer rounded bg-orange-500/15 px-2 py-0.5 font-mono text-[11px] text-orange-300 transition-colors hover:bg-orange-500/25 disabled:opacity-50"
                >
                  {evaluating ? "evaluating…" : "evaluate todos"}
                </button>
                <span className="min-w-0 truncate font-mono text-[10px] text-zinc-500">
                  {view.evaluatedCount}/{view.activeCount} graphed
                  {view.unevaluatedCount > 0 && ` · ${view.unevaluatedCount} pending`}
                </span>
                <button
                  onClick={() => load()}
                  disabled={loading}
                  title="Refresh plan"
                  aria-label="Refresh plan"
                  className="ml-auto flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-orange-300 disabled:opacity-50"
                >
                  <svg
                    className={loading ? "animate-spin" : ""}
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                </button>
              </div>
              <div
                key={syncedAt ?? 0}
                className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[9px] text-zinc-600"
              >
                <span>
                  {evaluating
                    ? "evaluating — one batched claude call over the backlog…"
                    : syncedAt
                      ? `synced ${new Date(syncedAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        })}`
                      : ""}
                </span>
                {!evaluating &&
                  delta &&
                  (delta.changed ? (
                    <span
                      className="flex flex-wrap items-center gap-x-1.5 rounded px-1"
                      style={{ animation: "pl-flash 1.4s ease-out" }}
                    >
                      {delta.graphed !== 0 && (
                        <span className="text-zinc-400">graphed {signed(delta.graphed)}</span>
                      )}
                      {delta.batches !== 0 && (
                        <span className="text-zinc-400">batches {signed(delta.batches)}</span>
                      )}
                      {delta.stages !== 0 && (
                        <span className="text-zinc-400">stages {signed(delta.stages)}</span>
                      )}
                      {Math.abs(delta.savingsP50) >= 0.005 && (
                        <span className={delta.savingsP50 >= 0 ? ACCENT : "text-amber-400/80"}>
                          savings {signedUsd(delta.savingsP50)}
                        </span>
                      )}
                      {delta.tasksLeft !== 0 && (
                        <span className={delta.tasksLeft >= 0 ? ACCENT : "text-amber-400/80"}>
                          tasks {signed(delta.tasksLeft)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-zinc-700">· no change</span>
                  ))}
              </div>
            </div>

            {/* ── HERO ── */}
            <div className="relative min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30 p-3.5">
              <div
                className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(249,115,22,0.16), transparent 70%)",
                }}
              />
              <div className="relative">
                <div className={LABEL}>
                  {throughputHero ? "Tasks before your reset" : "Savings this run · Min"}
                  {!throughputHero && view.dollars.seats > 1 && ` · ${view.dollars.seats} seats`}
                </div>
                <div className="mt-1 flex items-end gap-2.5">
                  <span className="font-mono text-4xl font-bold leading-none tracking-tight text-orange-400 [text-shadow:0_0_18px_rgba(249,115,22,0.35)]">
                    {throughputHero ? (
                      <HeroNumber
                        value={view.throughput.tasksLeftBatched}
                        format={(n) => `${Math.round(n)}`}
                      />
                    ) : (
                      <HeroNumber value={view.dollars.savingsP50} format={(n) => usd(n)} />
                    )}
                  </span>
                  <span className="mb-0.5 rounded bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] text-orange-300">
                    {throughputHero
                      ? `▲ ${view.throughput.multiplier.toFixed(1)}×`
                      : `Max ${usd(view.dollars.savingsP90)}`}
                  </span>
                </div>
                <div className="mt-2 font-mono text-[10px] text-zinc-500">
                  {throughputHero ? (
                    <>vs {view.throughput.tasksLeftSolo} un-batched · {view.throughput.multiplier.toFixed(1)}× more / reset</>
                  ) : (
                    <>
                      {Math.round(view.dollars.savingsPctP50)}–
                      {Math.round(view.dollars.savingsPctP90)}% off · ~{usd(view.dollars.annualSavingsP50)}/yr
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── RESET WINDOW — one signal: how full, and when it resets ── */}
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>Reset window</span>
              <Ticks pct={view.throughput.windowPct} lit={lit} />
              <span className="font-mono text-[9px] text-zinc-500">
                {Math.round(view.throughput.windowPct * 100)}% used · resets in{" "}
                {fmtDur(view.throughput.blockReset - Date.now())}
              </span>
            </div>

            {/* ── COST: UN-BATCHED vs BATCHED ── */}
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={LABEL}>Cost this run</span>
                <span className="font-mono text-[9px] text-zinc-500">
                  cold ctx {tok(view.cold.p50)}–{tok(view.cold.p90)}{" "}
                  {view.cold.measured ? "measured" : "estimated"}
                </span>
              </div>
              <Bar
                label="Un-batched"
                value={usd(view.dollars.soloP50)}
                pct={view.dollars.soloP50 / maxCost}
                lit={lit}
              />
              <Bar
                label="Batched"
                value={usd(view.dollars.batchedP50)}
                pct={view.dollars.batchedP50 / maxCost}
                accent
                lit={lit}
              />
              <div className="flex items-center justify-between font-mono text-[9px]">
                <span className="text-zinc-500">
                  saved <span className={ACCENT}>Min {usd(view.dollars.savingsP50)}</span> ·{" "}
                  <span className={ACCENT}>Max {usd(view.dollars.savingsP90)}</span>
                </span>
                {view.summaryP50.premiumBatches > 0 && (
                  <span className="text-amber-400/80">
                    {view.summaryP50.premiumBatches} batch(es) 200k+
                  </span>
                )}
              </div>
            </div>

            {/* ── PIPELINE ── */}
            <div className="flex min-w-0 flex-col">
              <span className={LABEL}>
                {view.batches.length} batches · {view.plan.stages} stage
                {view.plan.stages > 1 ? "s" : ""}
                {view.plan.cyclic.length > 0 && ` · ${view.plan.cyclic.length} cyclic`}
              </span>
              {view.batches.map((b, i) => {
                const isOpen = openBatch === b.id; // bullets dropdown
                const isFiles = filesBatch === b.id; // files dropdown
                return (
                  <div
                    key={b.id}
                    draggable
                    title="drag into a terminal to stage its prompt in the send box"
                    onDragStart={(e) => {
                      const p = runPrompt(b);
                      e.dataTransfer.setData("text/plain", p);
                      e.dataTransfer.setData(DND_TODO, p);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className={`group flex min-h-20 min-w-0 cursor-grab flex-col rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50 active:cursor-grabbing ${
                      i === 0 ? "mt-3 mb-1.5" : "my-1.5"
                    }`}
                    style={{ animation: "pl-rise .4s ease both", animationDelay: `${i * 45}ms` }}
                  >
                    {/* header — Batch (h2) over Stage (caption); savings is the h1.
                        Click anywhere on it to toggle the task bullets. */}
                    <div
                      onClick={() => setOpenBatch(isOpen ? null : b.id)}
                      className="flex min-w-0 cursor-pointer items-start justify-between gap-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="font-mono text-sm font-semibold text-zinc-100">
                          Batch {batchNum.get(b.id)}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-orange-400">
                          Stage {b.stage + 1}
                          {b.serialAfter && (
                            <span className="text-amber-400/70">
                              {" "}
                              · after batch {batchNum.get(b.serialAfter) ?? "?"}
                            </span>
                          )}
                        </span>
                      </div>
                      <span
                        className="shrink-0 font-mono text-lg font-bold text-emerald-300"
                        title="saved by batching vs running these un-batched"
                      >
                        {usd(b.savings)}
                      </span>
                    </div>
                    {/* action buttons (send-box model-selector style) + tokens —
                        pushed to the card's bottom */}
                    <div className="mt-auto flex items-center gap-1 pt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilesBatch(isFiles ? null : b.id);
                        }}
                        className={`flex items-center rounded-md px-1.5 py-1 font-mono text-[11px] transition-colors ${
                          isFiles
                            ? "bg-zinc-800 text-zinc-100"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        }`}
                      >
                        {b.files.length} files {isFiles ? "▴" : "▾"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyPrompt(b.id, runPrompt(b));
                        }}
                        className="flex items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                      >
                        {copied === b.id ? "copied ✓" : "copy prompt"}
                      </button>
                      <span className="ml-auto font-mono text-[11px] text-zinc-500">
                        {tok(b.outTokens)} tok
                      </span>
                    </div>
                    {/* files dropdown — cost demoted here as a supporting detail.
                        Chips are RESOLVED against disk: a real file is click-to-copy
                        (the BoundaryChip idiom); a struck chip = the evaluator
                        guessed a path that resolves to nothing. */}
                    {isFiles && (
                      <div className="mt-2 flex flex-col gap-1.5 border-t border-zinc-800 pt-2">
                        <p className="font-mono text-[9px] text-zinc-500">
                          {usd(b.usd)} cost · {tok(b.weighted)} weighted
                          {b.premiumTurns > 0 && " · 200k+ premium"}
                          {b.files.some((f) => !f.exists) &&
                            ` · ${b.files.filter((f) => !f.exists).length} unverified`}
                        </p>
                        {b.files.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {b.files.map((f) =>
                              f.exists ? (
                                <button
                                  key={f.copy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyPrompt(f.copy, f.copy);
                                  }}
                                  title={`${f.copy} — click to copy path${
                                    f.ambiguous ? " (ambiguous: basename matched >1 file)" : ""
                                  }`}
                                  className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                                >
                                  {copied === f.copy ? "copied ✓" : f.name}
                                  {f.ambiguous && <span className="text-amber-400/70"> ?</span>}
                                </button>
                              ) : (
                                <span
                                  key={f.copy}
                                  title={`${f.copy} — no file resolved on disk (evaluator guess)`}
                                  className="rounded px-1.5 py-0.5 font-mono text-[9px] text-zinc-600 line-through decoration-zinc-700/60"
                                >
                                  {f.name}
                                </span>
                              )
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-[9px] text-zinc-600">
                            no files inferred — re-evaluate for sharper grouping
                          </span>
                        )}
                      </div>
                    )}
                    {/* bullets dropdown */}
                    {isOpen && (
                      <ul className="mt-2 flex min-w-0 flex-col gap-0.5 border-t border-zinc-800 pt-2">
                        {b.taskIds.map((id) => (
                          <li key={id} className="min-w-0 truncate text-[11px] text-zinc-300">
                            <span className="text-zinc-600">·</span> {titleOf(id)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {view.batches.length === 0 && (
                <p className="mt-3 text-[11px] text-zinc-600">
                  no batches — evaluate todos first to build the graph.
                </p>
              )}
            </div>

            {/* ── CONFIG ── */}
            <div className="flex min-w-0 flex-col gap-2 border-t border-dashed border-zinc-800 pt-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <label className="flex items-center gap-1.5">
                  <span className={LABEL}>tier</span>
                  <select
                    value={view.config.tier ?? "max"}
                    onChange={(e) => patch({ tier: e.target.value })}
                    className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 transition-colors hover:border-orange-500/50 focus:outline-none"
                  >
                    {TIERS.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <span className={LABEL}>max/batch</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    defaultValue={view.config.maxBatch}
                    onBlur={(e) => patch({ maxBatch: Number(e.target.value) })}
                    className="w-12 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 transition-colors hover:border-orange-500/50 focus:outline-none"
                  />
                </label>
                {isApi && (
                  <label className="flex items-center gap-1.5">
                    <span className={LABEL}>seats</span>
                    <input
                      type="number"
                      min={1}
                      defaultValue={view.config.seats}
                      onBlur={(e) => patch({ seats: Number(e.target.value) })}
                      className="w-14 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 transition-colors hover:border-orange-500/50 focus:outline-none"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        )}
      </Boundary>
    </AppPanel>
  );
}

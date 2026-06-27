"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { FleetMetrics, Shape } from "@/lib/fleet";

// THE FLEET — hq's command deck over every live session. Two registers on one
// surface: the STRIP BOARD (left) is the "watch" half — the live roster from the
// REPL daemon (control = hq drives it · observe = a live TUI hq only mirrors),
// each strip carrying a context RUNWAY (a 1M track notched at the 200k price
// cliff). The CANVAS (right) is the "monitor" half — a KPI band + four chart
// SHAPES that re-SCOPE when you select a strip (Fleet ⇆ one session); the same
// shape vocabulary houses every metric. Select ≠ drive: clicking a strip scopes
// the canvas, ⤢ opens it in a terminal, ■ releases a control process. Roster
// polls /api/terminal/repl/list (~1.5s); the canvas polls /api/fleet/metrics
// (~8s, re-fetched on scope change). Dock collapses the deck to a strip that
// sits beside live terminals.
type FleetRow = {
  key: string;
  sessionId: string | null;
  mode: "control" | "observe";
  project: string;
  title: string;
  branch: string;
  cwd: string;
  running: boolean;
  busy: boolean;
  pending: number;
  watched: boolean;
  startedAt: number;
  lastActivity: number;
  contextTokens: number;
};

// The lifecycle — the session's CURRENT activity, in hq's meaningful colors.
// (loading/interrupted are real states too — workingStatus()/lastTurnInterrupted()
// surface them; deferred here to keep the 1.5s roster poll off per-row transcript
// reads. busy⇒working, recent-but-idle⇒done, stale⇒idle, gone⇒exited.)
type LState = "loading" | "working" | "done" | "interrupted" | "idle" | "exited";
const DONE_MS = 120_000;
function lifecycle(a: FleetRow): LState {
  if (!a.running) return "exited";
  if (a.busy) return "working";
  if (Date.now() - a.lastActivity < DONE_MS) return "done";
  return "idle";
}
const DOT: Record<LState, string> = {
  loading: "bg-blue-400",
  working: "bg-orange-400",
  done: "bg-emerald-400",
  interrupted: "bg-red-400",
  idle: "bg-amber-400",
  exited: "bg-zinc-600",
};
const TXT: Record<LState, string> = {
  loading: "text-blue-400",
  working: "text-orange-400",
  done: "text-emerald-400",
  interrupted: "text-red-400",
  idle: "text-amber-400",
  exited: "text-zinc-500",
};
const pulses = (s: LState) => s === "working" || s === "loading";

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Control vs observe — does hq DRIVE this agent or only MIRROR it? Distinguished
// by fill (control = solid) vs outline (observe), never by hue: the lifecycle
// owns every accent color, so the mode badge stays neutral and can't dilute them.
const modeBadge = (mode: FleetRow["mode"]) =>
  mode === "control" ? (
    <span
      title="hq drives this — ⤢ drive · ■ stop"
      className="rounded bg-zinc-800 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-zinc-300"
    >
      control
    </span>
  ) : (
    <span
      title="a live terminal hq mirrors but can't steer — ⤢ to take the wheel"
      className="rounded border border-zinc-700 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-zinc-500"
    >
      observe
    </span>
  );

// The runway — context fill on a 1M track, notched at the 200k price cliff,
// ramped green→amber→red by % LEFT (mirrors the terminal's ctx meter exactly).
function Runway({ ctx }: { ctx: number }) {
  const used = Math.min(100, (ctx / 1_000_000) * 100);
  const left = Math.max(0, 100 - used);
  const color = left > 25 ? "bg-emerald-500" : left > 10 ? "bg-amber-500" : "bg-red-500";
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded bg-zinc-800"
      title={ctx ? `${Math.round(ctx / 1000)}k ctx · ${Math.round(left)}% left` : "context unknown"}
    >
      <div className={`absolute inset-y-0 left-0 rounded ${color}`} style={{ width: `${used}%` }} />
      <div className="absolute -inset-y-0.5 w-px bg-amber-400/60" style={{ left: "20%" }} />
    </div>
  );
}

// ── shape renderers — the fixed chart vocabulary, neutral analytics ink ──────
function areaPath(points: number[], w = 300, h = 70): { line: string; area: string } {
  if (points.length < 2) return { line: "", area: "" };
  const max = Math.max(1, ...points);
  const step = w / (points.length - 1);
  const xy = points.map((p, i) => [i * step, h - (p / max) * (h - 6) - 3] as const);
  const line = "M" + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  return { line, area: `${line} L${w},${h} L0,${h} Z` };
}

function SeriesBody({ shape }: { shape: Extract<Shape, { kind: "series" }> }) {
  const { line, area } = areaPath(shape.points);
  return (
    <div>
      <svg viewBox="0 0 300 70" preserveAspectRatio="none" className="h-[64px] w-full" aria-hidden>
        <path d={area} fill="rgb(255 255 255 / 0.05)" />
        <path d={line} fill="none" stroke="rgb(212 212 216)" strokeWidth="1.5" />
      </svg>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.capL}</span>
        <span>{shape.capR}</span>
      </div>
    </div>
  );
}

function RankingBody({ shape }: { shape: Extract<Shape, { kind: "ranking" }> }) {
  if (!shape.rows.length) return <p className="text-[10px] text-zinc-600">—</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {shape.rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[64px_1fr_48px] items-center gap-2 text-[10px]">
          <span className="truncate text-zinc-300">{r.name}</span>
          <span className="h-2 overflow-hidden rounded bg-zinc-800">
            <i className="block h-full rounded bg-zinc-500" style={{ width: `${r.pct}%` }} />
          </span>
          <span className="text-right text-zinc-500">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function DistBody({ shape }: { shape: Extract<Shape, { kind: "distribution" }> }) {
  return (
    <div>
      <div className="flex h-[64px] items-end gap-1">
        {shape.bins.map((b, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t ${b.hot ? "bg-amber-500/70" : "bg-zinc-600"}`}
            style={{ height: `${Math.max(3, b.h)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] text-zinc-600">
        <span>{shape.xL}</span>
        <span>{shape.xR}</span>
      </div>
    </div>
  );
}

function ShapeCard({ shape }: { shape: Shape }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3">
      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="truncate text-[11px] text-zinc-400">{shape.title}</span>
        <span className="ml-auto rounded border border-zinc-800 px-1.5 text-[8px] uppercase tracking-widest text-zinc-600">
          {shape.kind}
        </span>
      </div>
      {shape.kind === "series" && <SeriesBody shape={shape} />}
      {shape.kind === "ranking" && <RankingBody shape={shape} />}
      {shape.kind === "distribution" && <DistBody shape={shape} />}
    </div>
  );
}

export default function FleetView() {
  const [agents, setAgents] = useState<FleetRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);
  const [scopeId, setScopeId] = useState<string | null>(null); // null = fleet grain
  const [posture, setPosture] = useState<"deck" | "dock">("deck");
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();

  // roster — live, ~1.5s
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await fetch("/api/terminal/repl/list", { cache: "no-store" }).then((r) => r.json());
        if (alive) setAgents(Array.isArray(d?.agents) ? d.agents : []);
      } catch {
        /* keep last list on a blip */
      } finally {
        if (alive) {
          setLoaded(true);
          timer = setTimeout(load, 1500);
        }
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // canvas metrics — re-fetch on scope change, then ~8s
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const q = scopeId ? `?session=${encodeURIComponent(scopeId)}` : "";
    const load = async () => {
      try {
        const d = await fetch(`/api/fleet/metrics${q}`, { cache: "no-store" }).then((r) => r.json());
        if (alive) setMetrics(d);
      } catch {
        /* keep last canvas on a blip */
      } finally {
        if (alive) timer = setTimeout(load, 8000);
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [scopeId]);

  // ⤢ — switch Terminal 1 to this agent + reveal it (drop ?center); keep pins.
  const switchHref = (sessionId: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", sessionId);
    sp.delete("center");
    return `${pathname}${sp.toString() ? `?${sp}` : ""}`;
  };
  const stop = async (e: React.MouseEvent, session: string) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch("/api/terminal/repl", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop", session }),
    }).catch(() => {});
  };

  const census = agents.reduce<Record<string, number>>((m, a) => {
    if (a.running) {
      const s = lifecycle(a);
      m[s] = (m[s] ?? 0) + 1;
    }
    return m;
  }, {});
  const order: LState[] = ["loading", "working", "done", "interrupted", "idle"];

  const stripRow = (a: FleetRow) => {
    const id = a.sessionId || a.key;
    const state = lifecycle(a);
    const selected = scopeId === id;
    return (
      <div
        key={a.key}
        role="button"
        tabIndex={0}
        onClick={() => setScopeId(selected ? null : id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setScopeId(selected ? null : id)}
        title={a.cwd}
        className={`group flex cursor-pointer flex-col gap-1.5 rounded-md border px-2.5 py-2 transition-colors ${
          selected
            ? "border-zinc-600 bg-zinc-900"
            : "border-zinc-800/70 hover:border-zinc-700 hover:bg-zinc-900/60"
        } ${a.running ? "" : "opacity-50"}`}
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span className="relative flex size-2 items-center justify-center">
            {pulses(state) && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${DOT[state]} opacity-60`} />
            )}
            <span className={`relative inline-flex size-2 rounded-full ${DOT[state]}`} />
          </span>
          <span className="font-medium text-zinc-200">{a.project}</span>
          <span className="text-[10px] text-zinc-600">{id.slice(0, 8)}</span>
          <span className="ml-auto">{modeBadge(a.mode)}</span>
        </div>
        <Runway ctx={a.contextTokens} />
        <div className="flex items-center gap-2 text-[9px]">
          <span className={TXT[state]}>{state}</span>
          {a.branch && <span className="truncate text-zinc-600">⎇ {a.branch}</span>}
          <span className="text-zinc-600">· {ago(a.lastActivity)}</span>
          <span className="ml-auto flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            <Link
              href={switchHref(id)}
              scroll={false}
              onClick={(e) => e.stopPropagation()}
              title="Drive in a terminal"
              className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
            >
              ⤢
            </Link>
            {a.running && a.mode === "control" && (
              <button
                type="button"
                onClick={(e) => stop(e, id)}
                title="Stop this agent (release the process)"
                className="rounded p-0.5 text-zinc-600 hover:text-red-300"
              >
                ■
              </button>
            )}
          </span>
        </div>
      </div>
    );
  };

  const censusRow = (
    <span className="flex items-center gap-2.5 text-[11px] text-zinc-500">
      {order
        .filter((s) => census[s])
        .map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-zinc-300">
            <i className={`size-1.5 rounded-full ${DOT[s]}`} />
            {census[s]} {s}
          </span>
        ))}
      <span className="text-zinc-600">· {agents.length} live</span>
    </span>
  );

  // ── dock — collapsed beside live terminals ─────────────────────────────────
  if (posture === "dock") {
    const hero = metrics?.shapes.find((s): s is Extract<Shape, { kind: "series" }> => s.kind === "series");
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 font-mono">
        <div className="flex items-center gap-3 border-b border-zinc-800/60 pb-2 text-[11px]">
          <span className="uppercase tracking-widest text-zinc-200">Fleet</span>
          {censusRow}
          <button
            type="button"
            onClick={() => setPosture("deck")}
            className="ml-auto rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
          >
            Deck
          </button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {agents.slice(0, 4).map((a) => (
              <div key={a.key} className="flex w-28 items-center gap-1.5">
                <span className={`size-1.5 shrink-0 rounded-full ${DOT[lifecycle(a)]}`} />
                <span className="shrink-0 text-[10px] text-zinc-400">{a.project}</span>
                <Runway ctx={a.contextTokens} />
              </div>
            ))}
          </div>
          {hero && (
            <div className="ml-auto w-48">
              <SeriesBody shape={hero} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── deck — strip board + canvas ────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 font-mono">
      <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800/60 pb-2 text-[11px]">
        <span className="uppercase tracking-widest text-zinc-200">Fleet</span>
        {censusRow}
        <button
          type="button"
          onClick={() => setPosture("dock")}
          className="ml-auto rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          Dock
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[230px_1fr] gap-3">
        {/* strip board — the roster */}
        <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto border-r border-zinc-800/60 pr-2">
          <div className="px-1 text-[9px] uppercase tracking-widest text-zinc-600">Strip board · select scopes ▸</div>
          {agents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[11px]">
              <span className="size-2 rounded-full bg-zinc-700" />
              {loaded ? (
                <p className="text-zinc-500">No live sessions — the dashboard still reads your whole history →</p>
              ) : (
                <p className="text-zinc-500">loading fleet…</p>
              )}
            </div>
          ) : (
            agents.map(stripRow)
          )}
        </div>

        {/* canvas — the dashboard */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span>
              <b className="font-medium text-zinc-200">Fleet</b>
              {metrics && (
                <>
                  <span className="mx-1.5 text-zinc-700">▸</span>
                  {metrics.scope.level === "session" ? (
                    <b className="font-medium text-zinc-200">{metrics.scope.label}</b>
                  ) : (
                    metrics.scope.label
                  )}
                </>
              )}
            </span>
            {scopeId && (
              <button
                type="button"
                onClick={() => setScopeId(null)}
                className="ml-auto rounded border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                ← Fleet
              </button>
            )}
          </div>

          {!metrics ? (
            <p className="text-[10px] text-zinc-600">loading metrics…</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {metrics.kpis.map((k) => (
                  <div key={k.label} className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-2">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">{k.label}</div>
                    <div className="mt-1 text-[19px] leading-none tracking-tight text-zinc-100">{k.value}</div>
                    {k.sub && <div className="mt-1 text-[9px] text-zinc-600">{k.sub}</div>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {metrics.shapes.map((s, i) => (
                  <ShapeCard key={i} shape={s} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

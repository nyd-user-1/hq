import { Section, SectionHead, Shot } from "./primitives";
import type { Spec } from "./spec-drawer";

// SCALE — the Fleet board (the ?session=@fleet "Analytics" view), Linear's Insights
// money-shot in hq's vocabulary: the real registry's stat cards on top, then the
// stacked-area Tokens/day and the Tokens-by-project ranking bars. Numbers are
// consistent with the Cost section's real figures (1.8B raw/wk · 4,418 msgs ·
// $7.5k wk · $296.52 today). Charts are hand-rolled SVG, like the app's own.

const SPECS: Spec[] = [
  {
    n: "4.1",
    title: "The metric registry",
    desc: <>40+ metrics over 15 chart shapes — stat, series, area, ranking, heatmap, scatter, stacked-area, gantt — every one computed from the transcripts at request time. No warehouse, no ETL.</>,
    file: "lib/fleet.ts",
  },
  {
    n: "4.2",
    title: "Dependency-free charts",
    desc: <>Hand-rolled SVG with a requestAnimationFrame path-morph on range changes. No chart library — the whole app ships on three runtime deps.</>,
    file: "app/ui/fleet",
  },
  {
    n: "4.3",
    title: "Composable boards",
    desc: <>A from-scratch drag-and-resize grid: place any metric, scope it to the fleet or a single session, save the view. The board is yours, not a fixed dashboard.</>,
    file: "fleet-grid.tsx",
  },
  {
    n: "4.4",
    title: "Full-text history",
    desc: <>FTS5 on <span className="font-mono text-zinc-300">node:sqlite</span> — a runtime built-in — indexes every transcript in ~8s. Sessions newer than the snapshot are live-scanned and merged on top.</>,
    file: "lib/sqlite.ts",
  },
];

const STATS: { label: string; value: string; sub: string; tone: string }[] = [
  { label: "sessions", value: "41", sub: "recent", tone: "#22c55e" },
  { label: "tokens", value: "1.8B", sub: "raw · wk", tone: "#3b82f6" },
  { label: "turns", value: "4,418", sub: "wk", tone: "#a1a1aa" },
  { label: "projects", value: "23", sub: "all-time", tone: "#a1a1aa" },
  { label: "spend", value: "$7.5k", sub: "$296.52 today", tone: "#f97316" },
  { label: "ctx cliff", value: "6", sub: "past 200k", tone: "#fbbf24" },
];

// Tokens/day, stacked by model (the registry's model-mix tones: opus orange,
// sonnet blue, haiku green). 14 days, weighted M.
const OPUS = [38, 52, 44, 61, 58, 40, 22, 55, 70, 64, 78, 66, 84, 92];
const SONNET = [12, 16, 10, 18, 22, 14, 8, 20, 24, 18, 26, 22, 30, 34];
const HAIKU = [4, 6, 3, 5, 8, 4, 2, 6, 9, 7, 10, 8, 12, 14];

const W = 300;
const H = 100;
const MAX = 150;
const px = (i: number) => (i / (OPUS.length - 1)) * W;
const py = (v: number) => H - 2 - (v / MAX) * (H - 10);
const line = (vals: number[]) =>
  vals.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
const band = (lower: number[], upper: number[]) => {
  const back = [...lower]
    .reverse()
    .map((v, i) => `L${px(lower.length - 1 - i).toFixed(1)},${py(v).toFixed(1)}`)
    .join(" ");
  return `${line(upper)} ${back} Z`;
};

const CUM1 = OPUS;
const CUM2 = OPUS.map((v, i) => v + SONNET[i]);
const CUM3 = CUM2.map((v, i) => v + HAIKU[i]);
const BASE = OPUS.map(() => 0);

const LAYERS: { name: string; tone: string; lower: number[]; upper: number[] }[] = [
  { name: "opus", tone: "#f97316", lower: BASE, upper: CUM1 },
  { name: "sonnet", tone: "#3b82f6", lower: CUM1, upper: CUM2 },
  { name: "haiku", tone: "#22c55e", lower: CUM2, upper: CUM3 },
];

const RANKING = [
  { name: "hq", pct: 100, value: "1.4B" },
  { name: "nysgpt", pct: 37, value: "512M" },
  { name: "hq-native", pct: 27, value: "380M" },
  { name: "scout", pct: 15, value: "210M" },
  { name: "dotfiles", pct: 6, value: "84M" },
  { name: "vault", pct: 3, value: "37M" },
];

export default function Scale() {
  return (
    <Section id="scale">
      <SectionHead
        n="4.0"
        name="Scale"
        title={
          <>
            Numbers for the whole fleet.
            <br />
            <span className="text-zinc-500">Computed from disk, on demand.</span>
          </>
        }
        desc={
          <>
            Fleet is a composable KPI board — 40+ metrics over 15 chart shapes, scoped to the whole
            fleet or a single session, on a drag-and-resize grid. Every figure is derived from the
            transcripts at request time. Nothing is collected, because everything is already there.
          </>
        }
        specs={SPECS}
      />
      <div className="mt-14">
        <Shot chip="fleet">
          <div className="flex flex-col gap-4 p-1 sm:p-2">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-800 bg-zinc-800/60 sm:grid-cols-3 lg:grid-cols-6">
              {STATS.map((s) => (
                <div key={s.label} className="bg-zinc-950 p-4">
                  <div className="font-mono text-[11px] text-zinc-500">{s.label}</div>
                  <div className="mt-1.5 text-2xl font-semibold tracking-tight" style={{ color: s.tone }}>
                    {s.value}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-zinc-600">{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="grid items-stretch gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[12px] text-zinc-400">Tokens / day · by model</span>
                  <span className="flex gap-4 font-mono text-[11px] text-zinc-500">
                    {LAYERS.map((l) => (
                      <span key={l.name} className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: l.tone }} />
                        {l.name}
                      </span>
                    ))}
                  </span>
                </div>
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="mt-3 h-40 w-full"
                  aria-hidden
                >
                  {LAYERS.map((l) => (
                    <path key={l.name} d={band(l.lower, l.upper)} fill={l.tone} fillOpacity="0.28" />
                  ))}
                  {LAYERS.map((l) => (
                    <path
                      key={`${l.name}-line`}
                      d={line(l.upper)}
                      fill="none"
                      stroke={l.tone}
                      strokeWidth="1.25"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
                <div className="mt-2 flex justify-between font-mono text-[11px] text-zinc-600">
                  <span>14d ago</span>
                  <span>today</span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <div className="font-mono text-[12px] text-zinc-400">Tokens by project · all-time</div>
                <div className="mt-4 flex flex-col gap-3.5">
                  {RANKING.map((r) => (
                    <div key={r.name}>
                      <div className="flex items-baseline justify-between font-mono text-[12px]">
                        <span className="text-zinc-300">{r.name}</span>
                        <span className="text-zinc-500">{r.value}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-blue-500/70"
                          style={{ width: `${r.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Shot>
        <p className="mt-5 font-mono text-xs text-zinc-600">
          the real <span className="text-zinc-400">?session=@fleet</span> board — 40+ metrics · 15 shapes · drag, resize, save views
        </p>
      </div>
    </Section>
  );
}

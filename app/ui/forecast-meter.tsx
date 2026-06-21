import { getForecast } from "@/lib/usage";

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

function clock(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" ", "");
}

// Forward-looking companion to the % meter: burn rate (weighted tokens/min over
// a trailing window) projected against the session cap. Answers "at this pace,
// when do we hit the cap" — the live antidote to "why am I suddenly at 100K".
export default function ForecastMeter() {
  const f = getForecast();
  const now = Date.now();
  const minsToReset = Math.max((f.blockReset - now) / 60000, 0);

  const usedPct = Math.min((f.blockWeighted / f.limit) * 100, 100);
  const projectedAtReset = f.blockWeighted + f.burnPerMin * minsToReset;
  const projectedPct = Math.min((projectedAtReset / f.limit) * 100, 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-zinc-300">Burn forecast · 5h block</span>

        {/* timeline track: used (solid) + projected-by-reset (faint) + NOW marker */}
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-orange-500/25"
            style={{ width: `${projectedPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-orange-500"
            style={{ width: `${usedPct}%` }}
          />
          <div
            className="absolute inset-y-0 w-px bg-zinc-100"
            style={{ left: `${usedPct}%` }}
          />
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs text-zinc-500">
          <span>
            now <span className="text-zinc-300">{fmt(f.blockWeighted)}</span> /{" "}
            {fmt(f.limit)} · {Math.round(usedPct)}%
          </span>
          <span>
            by {clock(f.blockReset)}:{" "}
            <span className="text-orange-300">~{Math.round(projectedPct)}%</span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-orange-500" /> used now
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-orange-500/25" /> projected by reset
        </span>
      </div>
    </div>
  );
}

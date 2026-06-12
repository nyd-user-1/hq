import { getUsage, type Totals } from "@/lib/usage";

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

const SEGMENTS: { key: keyof Totals; label: string; color: string }[] = [
  { key: "cacheRead", label: "cache read", color: "bg-zinc-700" },
  { key: "cacheCreate", label: "cache write", color: "bg-zinc-500" },
  { key: "input", label: "fresh input", color: "bg-zinc-300" },
  { key: "output", label: "output", color: "bg-blue-500" },
];

// part="head" renders only the first window (always-visible accordion row);
// part="rest" renders the remaining windows + legend + footnote.
export default function TokenMeter({
  part,
}: {
  part?: "head" | "rest";
} = {}) {
  const { windows } = getUsage();
  const maxWeighted = Math.max(...windows.map((w) => w.weightedTotal), 1);
  const shown =
    part === "head" ? windows.slice(0, 1) : part === "rest" ? windows.slice(1) : windows;

  return (
    <div className="flex flex-col gap-4">
      {shown.map((w) => {
        const raw =
          w.totals.input +
          w.totals.cacheCreate +
          w.totals.cacheRead +
          w.totals.output;
        const wt = w.weightedTotal;
        const pct = w.limit ? Math.min((wt / w.limit) * 100, 100) : null;
        const pctColor =
          pct === null
            ? ""
            : pct < 50
              ? "text-green-500"
              : pct < 75
                ? "text-yellow-500"
                : pct < 90
                  ? "text-orange-500"
                  : "text-red-500";
        return (
          <div key={w.label} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm text-zinc-300">{w.label}</span>
              <span className="font-mono text-xs text-zinc-500">
                {fmt(wt)} weighted · {fmt(raw)} raw · {w.totals.messages} msgs
                {pct !== null && (
                  <>
                    {" · "}
                    <span className={pctColor}>{Math.round(pct)}%</span>
                  </>
                )}
              </span>
            </div>
            {pct !== null ? (
              // limit window: /usage-style track + fill
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-blue-600"
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : (
              // no limit: bar length = weighted share vs the week; fill = raw composition
              <div
                className="flex h-2.5 overflow-hidden rounded-full bg-zinc-900"
                style={{
                  width: `${Math.max((wt / maxWeighted) * 100, 2)}%`,
                }}
              >
                {SEGMENTS.map((s) => (
                  <div
                    key={s.key}
                    className={s.color}
                    style={{
                      width: `${raw ? (w.totals[s.key] / raw) * 100 : 0}%`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {part === "head" ? null : (
        <>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SEGMENTS.map((s) => (
          <span
            key={s.key}
            className="flex items-center gap-1.5 text-xs text-zinc-500"
          >
            <span className={`size-2 rounded-full ${s.color}`} />
            {s.label}
          </span>
        ))}
      </div>
      <p className="text-xs text-zinc-600">
        local transcripts · deduped by request · weighted = input-equivalents
        (cache read ×0.1, output ×5) × per-model tier (opus ×5) · limits
        recalibrated against /usage 2026-06-11 6:32pm (session 23%, week 43%) ·
        estimates
      </p>
        </>
      )}
    </div>
  );
}

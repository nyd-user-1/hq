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

const pctText = (p: number) =>
  p < 50 ? "text-green-500" : p < 75 ? "text-yellow-500" : p < 90 ? "text-orange-500" : "text-red-500";

// part="head" renders only the first window (always-visible accordion row);
// part="rest" renders the remaining windows + legend.
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
          w.totals.input + w.totals.cacheCreate + w.totals.cacheRead + w.totals.output;
        const wt = w.weightedTotal;
        const hasLimit = w.limit != null;
        // The % is CC's live rate-limit reading when a fresh snapshot covers this
        // window, else HQ's modeled weighted/limit estimate. Last 24h has no limit
        // → no %, just token volume.
        const live = w.livePct != null;
        const pct = hasLimit
          ? live
            ? w.livePct!
            : Math.min((wt / (w.limit ?? 1)) * 100, 100)
          : null;
        return (
          <div key={w.label} className="flex flex-col gap-1.5">
            {/* header: window + live/est badge */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-300">{w.label}</span>
              {hasLimit && (
                <span
                  title={
                    live
                      ? "live — Claude Code's real rate-limit window"
                      : "estimate — calibrated from local transcripts (no live snapshot yet)"
                  }
                  className={`flex items-center gap-1 font-mono text-[8px] uppercase tracking-wider ${
                    live ? "text-green-400" : "text-zinc-600"
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${live ? "bg-green-400" : "bg-zinc-600"}`}
                  />
                  {live ? "live" : "est"}
                </span>
              )}
            </div>

            {/* bar — fills to the % (limit windows) or the raw composition (no limit) */}
            {pct != null ? (
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : (
              <div
                className="flex h-2.5 overflow-hidden rounded-full bg-zinc-900"
                style={{ width: `${Math.max((wt / maxWeighted) * 100, 2)}%` }}
              >
                {SEGMENTS.map((s) => (
                  <div
                    key={s.key}
                    className={s.color}
                    style={{ width: `${raw ? (w.totals[s.key] / raw) * 100 : 0}%` }}
                  />
                ))}
              </div>
            )}

            {/* stat row — now UNDER the bar */}
            <span className="font-mono text-xs text-zinc-500">
              {pct != null && (
                <>
                  <span className={pctText(pct)}>{Math.round(pct)}%</span>
                  {" · "}
                </>
              )}
              {fmt(wt)} weighted · {fmt(raw)} raw · {w.totals.messages} msgs
            </span>
          </div>
        );
      })}
      {part === "head" ? null : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className={`size-2 rounded-full ${s.color}`} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

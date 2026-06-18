import Boundary from "@/app/ui/boundary";
import { getRecentCalls } from "@/lib/calls";
import { getSpend } from "@/lib/usage";
import { fmtUSD } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// Ledger: the most recent API round-trips priced in dollars, with a spend
// header (session / today / week). Tokens are demoted to the dim detail; the
// $ is the headline. Premium calls (past the 200k cliff, ~2x) are flagged.
export default function Calls() {
  const calls = getRecentCalls();
  const spend = getSpend();
  return (
    <Boundary topOnly bleedX label="@panel/calls/page.tsx">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
        <span className="uppercase tracking-wide text-zinc-600">spend</span>
        <span className="text-emerald-300">
          {fmtUSD(spend.session)}{" "}
          <span className="text-zinc-600">session</span>
        </span>
        <span className="text-zinc-300">
          {fmtUSD(spend.today)} <span className="text-zinc-600">today</span>
        </span>
        <span className="text-zinc-300">
          {fmtUSD(spend.week)} <span className="text-zinc-600">week</span>
        </span>
      </div>

      <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {calls.map((c, i) => (
          <li
            key={i}
            className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs"
          >
            <span className="text-zinc-600">
              {new Date(c.at).toLocaleTimeString()}
            </span>
            <span className="text-zinc-300">{c.project}</span>
            <span className="ml-auto flex items-baseline gap-2">
              <span className="text-zinc-600">
                {fmt(c.output)} out · {fmt(c.raw)} raw
              </span>
              <span
                className={`w-16 text-right font-medium ${
                  c.premium ? "text-amber-400" : "text-emerald-300"
                }`}
              >
                {fmtUSD(c.cost)}
                {c.premium && (
                  <span className="ml-0.5 text-[10px] text-amber-500/70">2×</span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-600">
        {calls.length} calls · last 48h (est.) · 2× = past the 200k cliff ·
        rates in lib/pricing.ts
      </p>
    </Boundary>
  );
}

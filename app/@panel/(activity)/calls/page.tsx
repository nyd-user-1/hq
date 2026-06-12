import Boundary from "@/app/ui/boundary";
import { getCalls } from "@/lib/calls";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// Calls: the most recent API round-trips on this machine with token cost.
export default function Calls() {
  const calls = getCalls();
  return (
    <Boundary label="@panel/calls/page.tsx">
      <ul className="flex flex-col gap-1.5">
        {calls.map((c, i) => (
          <li
            key={i}
            className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs"
          >
            <span className="text-zinc-600">
              {new Date(c.at).toLocaleTimeString()}
            </span>
            <span className="text-zinc-300">{c.project}</span>
            <span className="ml-auto text-zinc-500">
              {fmt(c.output)} out · {fmt(c.raw)} raw ·{" "}
              <span className="text-zinc-300">{fmt(c.weightedTokens)} wt</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-600">
        last {calls.length} API calls across the newest sessions · wt = weighted
        input-equivalents
      </p>
    </Boundary>
  );
}

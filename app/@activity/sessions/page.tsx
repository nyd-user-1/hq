import Boundary from "@/app/ui/boundary";
import { getSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

export default function Sessions() {
  const sessions = getSessions();
  return (
    <Boundary label="@activity/sessions/page.tsx">
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span
                className={`size-2 self-center rounded-full ${
                  s.active ? "bg-green-500" : "bg-zinc-700"
                }`}
              />
              <span className="text-sm font-medium text-zinc-200">
                {s.project}
              </span>
              <span className="ml-auto font-mono text-xs text-zinc-500">
                {ago(s.lastActive)}
              </span>
            </div>
            <p className="font-mono text-xs text-zinc-500">
              {s.messages} msgs · {fmt(s.weightedTokens)} weighted
            </p>
            {s.snippet && (
              <p className="truncate text-xs text-zinc-400">{s.snippet}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-600">
        every Claude Code session on this machine, last 7 days · green = active
        in the last 2 minutes
      </p>
    </Boundary>
  );
}

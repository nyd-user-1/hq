import Boundary from "@/app/ui/boundary";
import Link from "next/link";
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

// Clicking a session pins the center terminal to it via ?session=<id> — the
// terminal switches without remounting. The selected card (pinned, or the newest
// when unpinned — which is what the terminal shows) gets a blue outline.
export default async function Sessions({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  const sessions = getSessions();
  const selectedId = session ?? sessions[0]?.id;

  return (
    <Boundary label="@panel/sessions/page.tsx">
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => {
          const selected = s.id === selectedId;
          return (
            <li key={s.id}>
              <Link
                href={`/sessions?session=${s.id}`}
                scroll={false}
                className={`flex flex-col gap-1 rounded-md border px-3 py-2 transition-colors ${
                  selected
                    ? "border-blue-500 bg-blue-500/5 ring-1 ring-blue-500/40"
                    : "border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/50"
                }`}
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
                  {selected && (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-blue-400">
                      in terminal
                    </span>
                  )}
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
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-zinc-600">
        every Claude Code session on this machine, last 7 days · green = active
        in the last 2 minutes · blue = showing in the terminal · click one to
        drive it
      </p>
    </Boundary>
  );
}

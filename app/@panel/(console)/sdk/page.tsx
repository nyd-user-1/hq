import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import RefreshWhile from "@/app/ui/refresh-while";
import { getSdkSessions } from "@/lib/sessions";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// SDK panel: Agent/Code SDK runs (entrypoint "sdk-cli") — the ephemeral sessions
// the SDK spawns. Kept out of Recents so they don't flood it; surfaced here
// instead. Each row opens the run's full transcript in the Firehose
// everything-view (the right inspector for a finished, non-interactive run).
export default function Sdk() {
  const sessions = getSdkSessions();
  return (
    <Boundary topOnly bleedX label="@panel/(console)/sdk/page.tsx">
      <ul className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/firehose?session=${s.id}`}
              scroll={false}
              className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    s.active ? "bg-green-500" : "bg-zinc-700"
                  }`}
                />
                <span className="shrink-0 font-mono text-xs text-zinc-300">
                  {s.id.slice(0, 8)}
                </span>
                <span className="min-w-0 truncate font-mono text-xs text-zinc-600">
                  {s.project}
                </span>
                <span className="ml-auto shrink-0 font-mono text-xs text-zinc-500">
                  {ago(s.lastActive)}
                </span>
              </div>
              {s.title && (
                <p className="truncate text-xs text-zinc-400">{s.title}</p>
              )}
            </Link>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="text-xs text-zinc-600">no SDK runs in the last 7 days</li>
        )}
      </ul>
      <p className="text-xs text-zinc-600">
        Agent SDK runs (entrypoint sdk-cli) · kept out of Recents · click one to
        read its transcript in Firehose
      </p>
      <RefreshWhile active ms={3000} />
    </Boundary>
  );
}

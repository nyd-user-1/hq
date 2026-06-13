import Boundary from "@/app/ui/boundary";
import { getShipped } from "@/lib/shipped";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Shipped: the cross-project commit feed — what got shipped across every ~/code
// repo, newest first. Answers "what did I ship today?" across all projects.
export default function Shipped() {
  const ships = getShipped();
  return (
    <Boundary topOnly label="@panel/shipped/page.tsx">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Shipped</h3>
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          {ships.length} commits · all projects
        </span>
      </div>
      {ships.length > 0 ? (
        <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {ships.map((s) => (
            <li
              key={`${s.repo}:${s.sha}`}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="w-20 shrink-0 truncate font-mono text-[10px] uppercase tracking-wide text-blue-400/80">
                {s.repo}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                {s.sha}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-300">
                {s.subject}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                {ago(s.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600">no git repos under ~/code</p>
      )}
      <p className="text-xs text-zinc-600">
        git log across every ~/code repo · newest first
      </p>
    </Boundary>
  );
}

import Boundary from "@/app/ui/boundary";
import SkillLauncher from "@/app/ui/skill-launcher";
import { recentCommands } from "@/lib/transcript";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Skills = a categorized skill launcher (fires claude -p into the newest
// session) over Recent Runs, the live log of slash commands across transcripts.
export default function Skills() {
  const runs = recentCommands(8);
  return (
    <Boundary label="@panel/skills/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <SkillLauncher />

        <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            recent runs
          </span>
          {runs.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {runs.map((r, i) => (
                <li
                  key={`${r.at}-${i}`}
                  className="flex items-baseline gap-2 text-sm"
                >
                  <span className="shrink-0 font-mono text-zinc-300">
                    {r.command}
                  </span>
                  {r.arg && (
                    <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
                      {r.arg}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-blue-400/70">
                    {r.project}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
                    {ago(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">no commands logged yet</p>
          )}
        </div>
      </div>
    </Boundary>
  );
}

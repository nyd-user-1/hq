import Boundary from "@/app/ui/boundary";
import SkillLauncher from "@/app/ui/skill-launcher";
import { getSkills } from "@/lib/skills";
import { recentCommands } from "@/lib/transcript";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Skills = a skill browser + launcher. YOUR SKILLS are discovered from disk
// (~/.claude/skills — name + description parsed from each SKILL.md); BUILT-IN are
// the curated harness skills. Clicking a row fires claude -p into the newest
// session. Recent Runs is the live log of slash commands across transcripts.
export default function Skills() {
  const runs = recentCommands(8);
  return (
    <Boundary topOnly label="@panel/(console)/skills/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <SkillLauncher skills={getSkills()} />

        <section className="flex flex-col gap-1 border-t border-zinc-800 pt-3">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            recent runs
          </h2>
          {runs.length > 0 ? (
            <ul className="flex flex-col">
              {runs.map((r, i) => (
                <li
                  key={`${r.at}-${i}`}
                  className="flex items-baseline gap-2 border-b border-zinc-800/60 py-1.5 text-sm"
                >
                  <span className="shrink-0 font-mono text-zinc-300">
                    {r.command}
                  </span>
                  {r.arg && (
                    <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
                      {r.arg}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-blue-400/70">
                    {r.project}
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[11px] text-zinc-600">
                    {ago(r.at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-600">no commands logged yet</p>
          )}
        </section>
      </div>
    </Boundary>
  );
}

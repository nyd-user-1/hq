import Boundary from "@/app/ui/boundary";
import os from "node:os";
import Markdown from "@/app/ui/md";
import BackLink from "@/app/ui/back-link";
import CopyText from "@/app/ui/copy-text";
import SkillLauncher from "@/app/ui/skill-launcher";
import { getSkills, readSkillDoc } from "@/lib/skills";
import { recentCommands } from "@/lib/transcript";
import { ago } from "@/lib/ago";

export const dynamic = "force-dynamic";

// Skills = a skill browser + launcher. ADDED SKILLS are discovered from
// ~/.claude/skills (each row opens its SKILL.md here, ?open=<path>); BUILT-IN are
// curated harness skills (run on click). The command box runs anything. Recent
// Runs is the live log of slash commands across transcripts.
export default async function Skills({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; session?: string; pair?: string }>;
}) {
  const { open, session, pair } = await searchParams;
  const tail = [session && `session=${session}`, pair && `pair=${pair}`]
    .filter(Boolean)
    .join("&");

  // ── opened SKILL.md ───────────────────────────────────────────────────────
  if (open) {
    const content = readSkillDoc(open);
    const home = os.homedir();
    const shown = open.startsWith(home) ? `~${open.slice(home.length)}` : open;
    return (
      <Boundary topOnly bleedX label="@panel/(console)/skills/page.tsx">
        <div className="flex items-baseline gap-3">
          <BackLink
            href={tail ? `/skills?${tail}` : "/skills"}
            className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← skills
          </BackLink>
          <CopyText
            text={open}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            {shown}
          </CopyText>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto text-sm">
          {content ? (
            <Markdown text={content} />
          ) : (
            <p className="text-xs text-zinc-600">SKILL.md not found</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── browser + launcher ────────────────────────────────────────────────────
  const runs = recentCommands(8);
  return (
    <Boundary topOnly bleedX label="@panel/(console)/skills/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <SkillLauncher skills={getSkills()} session={session} pair={pair} />

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

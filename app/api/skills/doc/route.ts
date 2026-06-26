import { readSkillBody } from "@/lib/skills-library";

// Reads one SKILL.md off disk; never cache.
export const dynamic = "force-dynamic";

// GET ?path=<SKILL.md> — the skill's body (markdown, frontmatter stripped),
// fetched when a skill card is opened. Guarded to .md under ~/.claude.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return Response.json({ error: "a path is required" }, { status: 400 });
  return Response.json({ body: readSkillBody(p) });
}

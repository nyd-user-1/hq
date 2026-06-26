import { getSkillsLibrary } from "@/lib/skills-library";

// Reads ~/.claude/skills + enabled plugins' skills off disk; never cache.
export const dynamic = "force-dynamic";

// GET — the unified skills library (your skills + plugin-shipped + built-ins),
// each tagged with its source. The client searches/filters it.
export async function GET() {
  return Response.json({ skills: getSkillsLibrary() });
}

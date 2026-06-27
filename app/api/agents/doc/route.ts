import { readAgentBody } from "@/lib/agents";

// Reads one agent .md off disk; never cache.
export const dynamic = "force-dynamic";

// GET ?path=<agent.md> — the agent's body (markdown, frontmatter stripped),
// fetched when an agent card is opened. Guarded to .md under ~/.claude.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return Response.json({ error: "a path is required" }, { status: 400 });
  return Response.json({ body: readAgentBody(p) });
}

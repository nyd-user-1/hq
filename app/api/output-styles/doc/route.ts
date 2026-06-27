import { readStyleBody } from "@/lib/output-styles";

// Reads one output-style .md off disk; never cache.
export const dynamic = "force-dynamic";

// GET ?path=<style.md> — the style's body (markdown, frontmatter stripped),
// fetched when a style card is opened. Guarded to .md under ~/.claude.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return Response.json({ error: "a path is required" }, { status: 400 });
  return Response.json({ body: readStyleBody(p) });
}

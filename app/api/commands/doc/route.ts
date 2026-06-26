import { readCommandBody } from "@/lib/commands-library";

// Reads one command file off disk; never cache.
export const dynamic = "force-dynamic";

// GET ?path=<.md|.toml> — the command's body for the drill-down (user/plugin
// commands only; built-ins have no file). Guarded to ~/.claude.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return Response.json({ error: "a path is required" }, { status: 400 });
  return Response.json({ body: readCommandBody(p) });
}

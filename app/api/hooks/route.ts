import { getHooks } from "@/lib/hooks";

// Reads the settings.json hook blocks off disk; never cache.
export const dynamic = "force-dynamic";

// GET — every configured hook (user + this repo's project settings), flattened
// one-per-command and tagged with event + source. ?cwd= overrides the project
// dir folded in (defaults to the server's own repo).
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd") || process.cwd();
  return Response.json({ hooks: getHooks(cwd) });
}

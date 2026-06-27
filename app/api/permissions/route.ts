import { getPermissions, setRuleBucket, setDefaultMode, type Bucket } from "@/lib/permissions";

// Reads + writes ~/.claude/settings.json permissions; never cache.
export const dynamic = "force-dynamic";

// GET — every allow/ask/deny rule + the default mode, each tagged + danger-flagged.
export async function GET() {
  return Response.json(getPermissions());
}

// POST — mutate the rules. Localhost-only control surface (hq's trust boundary):
//   { op: "bucket", rule, bucket: "allow"|"ask"|"deny"|"remove" }
//   { op: "mode", mode: "default"|"auto"|"acceptEdits"|"plan"|"bypassPermissions" }
export async function POST(req: Request) {
  let body: { op?: string; rule?: string; bucket?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  try {
    if (body.op === "mode" && body.mode) return Response.json(setDefaultMode(body.mode));
    if (body.op === "bucket" && body.rule && body.bucket)
      return Response.json(setRuleBucket(body.rule, body.bucket as Bucket | "remove"));
    return Response.json({ error: "bad op" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
}

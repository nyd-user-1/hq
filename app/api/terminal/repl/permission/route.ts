import { NextResponse } from "next/server";
import { registerPermission } from "@/lib/repl";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The MCP shim (repl-approve-mcp.mjs) POSTs here for every tool-permission
// decision it can't auto-resolve, then BLOCKS on the response. registerPermission
// surfaces the ask to the browser (via the SSE feed) and holds this request open
// until the operator answers (POST /api/terminal/repl {action:"answer"}) or it
// times out. Fail-safe: any malformed/sessionless ask is denied.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.sessionId) {
    return NextResponse.json({ behavior: "deny", message: "no session" });
  }
  const decision = await registerPermission(body.sessionId, body);
  return NextResponse.json(decision);
}

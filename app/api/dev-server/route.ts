import { NextResponse } from "next/server";
import {
  startDevServer,
  stopDevServer,
  devServerStatus,
  devServerLog,
} from "@/lib/dev-server";

export const dynamic = "force-dynamic";

// GET → the current hq-managed dev server (or null) + its recent log.
// POST { action: "start", path, name, port } → start/reuse a project's dev server.
// POST { action: "stop" } → stop the hq-managed one.
export async function GET() {
  return NextResponse.json({ server: devServerStatus(), log: devServerLog() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body?.action === "stop") {
      stopDevServer();
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "start") {
      const { path, name, port } = body;
      if (typeof path !== "string" || typeof port !== "number")
        return NextResponse.json({ ok: false, error: "path + port required" }, { status: 400 });
      const result = await startDevServer(path, typeof name === "string" ? name : path, port);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

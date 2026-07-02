import { NextResponse, type NextRequest } from "next/server";
import { hqDevRunning, setHqDev } from "@/lib/hq-dev";

export const dynamic = "force-dynamic";

// The dev-server (:3002 launchd agent com.hq.dev) toggle — the UI affordance for
// the same explicit on/off the /hq-dev skill drives. Same-origin only (proxy.ts
// already guards the localhost trust boundary).
//
// GET  → { enabled }
// POST { enabled: boolean } → bootstrap/bootout + echo the real { enabled }
export async function GET() {
  return NextResponse.json({ enabled: hqDevRunning() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return new NextResponse("enabled (boolean) required", { status: 400 });
  }
  return NextResponse.json({ enabled: setHqDev(body.enabled) });
}

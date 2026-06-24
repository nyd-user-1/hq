import { NextResponse, type NextRequest } from "next/server";
import { isChannelEnabled, setChannelEnabled } from "@/lib/channel-mode";

export const dynamic = "force-dynamic";

// The experimental channel-in toggle (see lib/channel-mode.ts). This is the ONLY
// thing that turns the channel path on, so it can never engage by accident.
// Same-origin only (proxy.ts already guards the localhost trust boundary).
//
// GET  → { enabled }
// POST { enabled: boolean } → persist + echo { enabled }
export async function GET() {
  return NextResponse.json({ enabled: isChannelEnabled() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return new NextResponse("enabled (boolean) required", { status: 400 });
  }
  return NextResponse.json({ enabled: setChannelEnabled(body.enabled) });
}

import { NextResponse } from "next/server";
import { getFleetViews, saveFleetViews } from "@/lib/fleet-views";

export const dynamic = "force-dynamic";

// HQ-native saved Fleet views — a disk sidecar at ~/.claude/hq/fleet-views.json.
// GET → { views }. PUT { views } replaces the whole list (the client owns order +
// dedupe), returning the sanitized result.
export function GET() {
  return NextResponse.json({ views: getFleetViews() });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body?.views)) {
    return new NextResponse("views array required", { status: 400 });
  }
  return NextResponse.json({ views: saveFleetViews(body.views) });
}

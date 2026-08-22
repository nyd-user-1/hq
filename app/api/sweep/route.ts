import { NextResponse } from "next/server";
import {
  sweepCandidates,
  sweepSessions,
  keepSessions,
  unkeepSessions,
  SWEEP_THRESHOLD_DAYS,
} from "@/lib/sweep";

export const dynamic = "force-dynamic";

// GET  → the transcripts past the threshold, oldest first.
// POST → { action: "sweep" | "keep" | "unkeep", ids: string[] }
export function GET() {
  const candidates = sweepCandidates();
  return NextResponse.json({
    thresholdDays: SWEEP_THRESHOLD_DAYS,
    count: candidates.length,
    totalBytes: candidates.reduce((n, c) => n + c.sizeBytes, 0),
    candidates,
  });
}

export async function POST(req: Request) {
  let body: { action?: string; ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return NextResponse.json({ error: "no ids" }, { status: 400 });

  switch (body.action) {
    case "sweep":
      return NextResponse.json(sweepSessions(ids));
    case "keep":
      return NextResponse.json({ kept: keepSessions(ids) });
    case "unkeep":
      return NextResponse.json({ unkept: unkeepSessions(ids) });
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}

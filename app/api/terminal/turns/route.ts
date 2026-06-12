import { NextResponse } from "next/server";
import { turnsFor } from "@/lib/transcript";

export const dynamic = "force-dynamic";

// Backfill for the terminal island: the last N turns of a session (or the
// newest session when no id is given). Keeps node:fs server-side.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  const { id: resolved, turns, project } = turnsFor(id, 12);
  return NextResponse.json({ id: resolved, turns, project });
}

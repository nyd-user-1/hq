import { NextResponse } from "next/server";
import { tasksForTeam } from "@/lib/tasks";
import { teams } from "@/lib/teams";

// Reads ~/.claude/tasks/<id>/*.json off disk; never cache.
export const dynamic = "force-dynamic";

// GET ?team=<id> → that team's (or session's) shared task list. GET with no
// param → tasks aggregated across every known team, each record carrying its
// own teamId so the client can group them.
export function GET(req: Request) {
  const team = new URL(req.url).searchParams.get("team");
  if (team) return NextResponse.json({ tasks: tasksForTeam(team) });
  const tasks = teams().flatMap((t) => tasksForTeam(t.id));
  return NextResponse.json({ tasks });
}

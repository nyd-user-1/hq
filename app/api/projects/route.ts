import { NextResponse } from "next/server";
import { getProjects, getProjectSessions } from "@/lib/projects";

export const dynamic = "force-dynamic";

// GET → the project summary grid. GET ?name=<project> → that project's sessions
// (the in-panel drill-down). Feeds the standalone projects-panel (client) the same
// data the @panel/projects server page reads inline.
export function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (name) return NextResponse.json({ sessions: getProjectSessions(name) });
  return NextResponse.json({ projects: getProjects() });
}

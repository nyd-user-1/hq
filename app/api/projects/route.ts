import { NextResponse } from "next/server";
import { getProjects, getProjectSessions, deleteTempProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

// GET → the project summary grid. GET ?name=<project> → that project's sessions
// (the in-panel drill-down). Feeds the standalone projects-panel (client) the same
// data the @panel/projects server page reads inline.
export function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name");
  if (name) return NextResponse.json({ sessions: getProjectSessions(name) });
  return NextResponse.json({ projects: getProjects() });
}

// DELETE { name } → reclaim disk by removing a TEMP project's transcript buckets.
// Guarded in lib: refuses anything not classified `temp` and not under
// ~/.claude/projects, so real history can't be deleted.
export async function DELETE(req: Request) {
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || !name) {
    return new NextResponse("name required", { status: 400 });
  }
  const res = deleteTempProject(name);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}

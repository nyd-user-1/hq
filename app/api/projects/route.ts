import { NextResponse } from "next/server";
import { getProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

// GET — the project summary grid (lib/projects). Feeds the standalone
// projects-panel (client) the same data the @panel/projects server page passes
// inline to <ProjectsView>.
export function GET() {
  return NextResponse.json({ projects: getProjects() });
}

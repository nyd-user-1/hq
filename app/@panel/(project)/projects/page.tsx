import Boundary from "@/app/ui/boundary";
import { getProjects, getProjectSessions } from "@/lib/projects";
import ProjectsView from "@/app/ui/projects-view";
import ProjectSessions from "@/app/ui/project-sessions";

export const dynamic = "force-dynamic";

// Projects panel. No ?project → the card grid (claude.ai-style). ?project=<name>
// → that project's sessions, Skills-row styled; clicking a row pins the session
// in the terminal. Panel pages re-render on a query soft-nav (the Sessions
// Live/All chips prove it), so the drill-down needs no refresh hack.
export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  return (
    <Boundary topOnly bleedX label="@panel/projects/page.tsx">
      {project ? (
        <ProjectSessions name={project} sessions={getProjectSessions(project)} />
      ) : (
        <ProjectsView projects={getProjects()} />
      )}
    </Boundary>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useActivity, ACTIVITY_PANELS, type ActivityKey } from "@/app/ui/activity-state";
import GroupSwitchChip from "@/app/ui/group-switch-chip";
import GroupNavChips from "@/app/ui/group-nav-chips";
import { withPins } from "@/app/ui/keep-pins";
import ProjectsPanel from "@/app/ui/projects-panel";
import TodoPanel from "@/app/ui/todo-panel";
import ComponentsPanel from "@/app/ui/components-panel";
import ChangelogPanel from "@/app/ui/changelog-panel";
import IssuesPanel from "@/app/ui/issues-panel";
import TasksPanel from "@/app/ui/tasks-panel";
import { useProjectsPanel } from "@/app/ui/projects-panel-state";
import { useTodoPanel } from "@/app/ui/todo-panel-state";
import { useComponentsPanel } from "@/app/ui/components-panel-state";
import { useChangelog } from "@/app/ui/changelog-state";
import { useIssues } from "@/app/ui/issues-state";
import { useTasks } from "@/app/ui/tasks-state";

// The Activity container — ONE push-in panel hosting the Activity panels, swapping
// between them in place via the shared GroupSwitchChip + GroupNavChips. The dropdown
// carries a Search extra-row (→ /search) and sorts A–Z; the "↗" pops a member out.
export default function ActivityPanel() {
  const { open, setOpen, active, setActive } = useActivity();
  const meta = ACTIVITY_PANELS.find((p) => p.key === active) ?? ACTIVITY_PANELS[0];
  const router = useRouter();
  const params = useSearchParams();
  const standalone: Record<string, (v: boolean) => void> = {
    projects: useProjectsPanel().setOpen,
    todos: useTodoPanel().setOpen,
    components: useComponentsPanel().setOpen,
    changelog: useChangelog().setOpen,
    issues: useIssues().setOpen,
    tasks: useTasks().setOpen,
  };
  const select = (k: string) => setActive(k as ActivityKey);
  const searchRow = {
    key: "search",
    title: "Search",
    onOpen: () => router.push(withPins("/search", params.toString()), { scroll: false }),
  };

  return (
    <AppPanel rootId="activity-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={
          <GroupSwitchChip
            file={meta.file}
            active={active}
            members={ACTIVITY_PANELS}
            onSelect={select}
            onPopOut={(k) => standalone[k](true)}
            extraRows={[searchRow]}
            sortAZ
          />
        }
        trail={<GroupNavChips active={active} members={ACTIVITY_PANELS} onSelect={select} />}
      >
        {active === "projects" && <ProjectsPanel embedded />}
        {active === "todos" && <TodoPanel embedded />}
        {active === "components" && <ComponentsPanel embedded />}
        {active === "changelog" && <ChangelogPanel embedded />}
        {active === "issues" && <IssuesPanel embedded />}
        {active === "tasks" && <TasksPanel embedded />}
      </Boundary>
    </AppPanel>
  );
}

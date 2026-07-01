"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useActivity, ACTIVITY_PANELS } from "@/app/ui/activity-state";
import ActivitySwitchChip from "@/app/ui/activity-switch-chip";
import ProjectsPanel from "@/app/ui/projects-panel";
import TodoPanel from "@/app/ui/todo-panel";
import ComponentsPanel from "@/app/ui/components-panel";
import ChangelogPanel from "@/app/ui/changelog-panel";
import IssuesPanel from "@/app/ui/issues-panel";
import TasksPanel from "@/app/ui/tasks-panel";

// The Activity container — ONE push-in panel that hosts the Activity panels and swaps
// between them IN PLACE. Mirrors console-panel.tsx: the "⌄" switcher rides the boundary
// after the file-path chip; picking a panel changes `active`, which (a) re-keys the
// Boundary so the boundary-flash animation replays — a replace, not a push — and (b)
// swaps the chip label to that panel's file. Each panel renders content-only via its
// additive `embedded` prop (this container owns the AppPanel + Boundary).
export default function ActivityPanel() {
  const { open, setOpen, active, setActive } = useActivity();
  const meta = ACTIVITY_PANELS.find((p) => p.key === active) ?? ACTIVITY_PANELS[0];

  return (
    <AppPanel rootId="activity-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        trail={<ActivitySwitchChip active={active} onSelect={setActive} />}
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

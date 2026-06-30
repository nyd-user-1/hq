import { Suspense } from "react";
import { cookies } from "next/headers";
import Boundary from "@/app/ui/boundary";
import Sidebar from "@/app/ui/sidebar";
import SidebarColumn from "@/app/ui/sidebar-column";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import { SidebarProvider } from "@/app/ui/sidebar-state";
import PanelWrapper from "@/app/ui/panel-wrapper";
import TerminalRow from "@/app/ui/terminal-row";
import FilesOverlay from "@/app/ui/files-overlay";
import ProjectOverlay from "@/app/ui/project-overlay";
import FleetOverlay from "@/app/ui/fleet-overlay";
import { PlannerProvider } from "@/app/ui/planner-state";
import PlannerPanel from "@/app/ui/planner-panel";
import { ApiProvider } from "@/app/ui/api-state";
import ApiPanel from "@/app/ui/api-panel";
import { PluginsProvider } from "@/app/ui/plugins-state";
import PluginsPanel from "@/app/ui/plugins-panel";
import { SkillsProvider } from "@/app/ui/skills-state";
import SkillsPanel from "@/app/ui/skills-panel";
import { KpiProvider } from "@/app/ui/kpi-state";
import KpiPanel from "@/app/ui/kpi-panel";
import { CommandsProvider } from "@/app/ui/commands-state";
import CommandsPanel from "@/app/ui/commands-panel";
import { HooksProvider } from "@/app/ui/hooks-state";
import HooksPanel from "@/app/ui/hooks-panel";
import { McpProvider } from "@/app/ui/mcp-state";
import McpPanel from "@/app/ui/mcp-panel";
import { AgentsProvider } from "@/app/ui/agents-state";
import AgentsPanel from "@/app/ui/agents-panel";
import { OutputStylesProvider } from "@/app/ui/output-styles-state";
import OutputStylesPanel from "@/app/ui/output-styles-panel";
import { PermissionsProvider } from "@/app/ui/permissions-state";
import PermissionsPanel from "@/app/ui/permissions-panel";
import { PreviewProvider } from "@/app/ui/preview-state";
import PreviewPanel from "@/app/ui/preview-panel";
import { ChangelogProvider } from "@/app/ui/changelog-state";
import ChangelogPanel from "@/app/ui/changelog-panel";
import { ComponentsPanelProvider } from "@/app/ui/components-panel-state";
import ComponentsPanel from "@/app/ui/components-panel";
import { ProjectsPanelProvider } from "@/app/ui/projects-panel-state";
import ProjectsPanel from "@/app/ui/projects-panel";
import { TodoPanelProvider } from "@/app/ui/todo-panel-state";
import TodoPanel from "@/app/ui/todo-panel";
import { TeamsProvider } from "@/app/ui/teams-state";
import TeamsPanel from "@/app/ui/teams-panel";
import { TasksProvider } from "@/app/ui/tasks-state";
import TasksPanel from "@/app/ui/tasks-panel";
import { IssuesProvider } from "@/app/ui/issues-state";
import IssuesPanel from "@/app/ui/issues-panel";
import { TextEditorProvider } from "@/app/ui/text-editor-state";
import TextEditor from "@/app/ui/text-editor";
import { CommandProvider } from "@/app/ui/command-state";
import CommandPalette from "@/app/ui/command-palette";
import { FocusProvider } from "@/app/ui/focus-state";
import Terminal1Slot from "@/app/ui/terminal1-slot";
import TerminalChipMenu from "@/app/ui/terminal-chip-menu";
import ReorderListener from "@/app/ui/reorder-listener";

// Full-screen OS shell. Three peers: SIDEBAR (left, 210px), TERMINAL (center,
// always mounted — the persistent heart), and the right app-panel portal anchor.
// The terminal lives here (root layout) so it never unmounts as the sidebar
// navigates the panel. No outer layout.tsx boundary: its dashed box + chip +
// padding were removed so the three columns reclaim that space; the inner
// boundary chips poke into the root padding (p-3/lg:p-4).
export default async function Shell({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  // Seed the sidebar + focus mode from their cookies so a refresh keeps the last
  // choice. Read on the server → no flash. Sidebar defaults open; focus mode is
  // the DEFAULT layout (centered conversation shell) unless the user toggled to
  // wide (hq-focus="0").
  const jar = await cookies();
  const sidebarOpen = jar.get("hq-sidebar")?.value !== "0";
  const focusDefault = jar.get("hq-focus")?.value !== "0";
  return (
    <div className="flex h-dvh flex-col bg-zinc-950 p-6 text-zinc-100">
      {/* no row gap — the sidebar carries mr-4 while open (collapses with it)
          and the app panel brings its own ml-4, so closed = truly full width */}
      <CommandProvider>
      <FocusProvider>
      <PlannerProvider>
      <ApiProvider>
      <PluginsProvider>
      <SkillsProvider>
      <KpiProvider>
      <CommandsProvider>
      <HooksProvider>
      <McpProvider>
      <AgentsProvider>
      <OutputStylesProvider>
      <PermissionsProvider>
      <PreviewProvider>
      <ChangelogProvider>
      <ComponentsPanelProvider>
      <ProjectsPanelProvider>
      <TodoPanelProvider>
      <TeamsProvider>
      <TasksProvider>
      <IssuesProvider>
      <TextEditorProvider>
      <SidebarProvider initialOpen={sidebarOpen}>
        <div className="flex min-h-0 flex-1">
          <SidebarColumn>
            <Boundary label="sidebar.tsx" padX="px-2.5">
              <Sidebar />
            </Boundary>
          </SidebarColumn>

          {/* The protected column: a min-width floor so opening the sidebar
              squeezes the PANEL (which can shrink), not the terminal. `relative`
              so the Files browser (FilesOverlay) can cover it without touching the
              always-mounted terminal underneath. */}
          <div className="relative flex min-w-[380px] flex-1 flex-col gap-4">
            {/* WIREFRAME: PairColumn keeps Terminal 1 always-first so it never
                remounts; ?pair=<id> adds a mock Terminal 2 pane beside it. */}
            <TerminalRow initialFocus={focusDefault}>
              <Boundary
                label="terminal-1"
                copyText="app/ui/terminal.tsx"
                reorderSlot={1}
                lead={<SidebarToggle />}
                trail={
                  <Suspense fallback={null}>
                    <TerminalChipMenu target={{ kind: "t1" }} />
                  </Suspense>
                }
              >
                <Suspense
                  fallback={
                    <p className="text-sm text-zinc-600">loading terminal…</p>
                  }
                >
                  <Terminal1Slot initialFocus={focusDefault} />
                </Suspense>
              </Boundary>
            </TerminalRow>
            {children}
            {/* Files browser — covers the center when ?center=files; the terminal
                stays mounted + live behind it. Suspense for useSearchParams. */}
            <Suspense fallback={null}>
              <FilesOverlay />
              <ProjectOverlay />
              <FleetOverlay />
            </Suspense>
          </div>

          {/* min-w-0 (not shrink-0) so the panel yields when the row is tight —
              the terminal's min-width holds, the panel shrinks. */}
          <div id="app-panel-root" className="flex h-full min-w-0" />
          {/* The independent Batch Planner's own portal root — a second panel
              that can be open AT THE SAME TIME as #app-panel-root. */}
          <div id="planner-panel-root" className="flex h-full min-w-0" />
          {/* The independent API (usage) panel's own portal root — another peer
              that can sit open alongside the route panel and the planner. */}
          <div id="api-panel-root" className="flex h-full min-w-0" />
          {/* The independent Plugins library panel's own portal root — a peer that
              can sit open alongside the route panel, the planner, and the API. */}
          <div id="plugins-panel-root" className="flex h-full min-w-0" />
          {/* The independent Skills library panel's own portal root — first of
              the console panels to migrate out of @panel/(console). */}
          <div id="skills-panel-root" className="flex h-full min-w-0" />
          {/* The independent Commands library panel's own portal root. */}
          <div id="commands-panel-root" className="flex h-full min-w-0" />
          {/* The Console capability panels — Hooks · MCP · Agents · Output Styles,
              each its own client-state portal, siblings of Skills/Commands. */}
          <div id="hooks-panel-root" className="flex h-full min-w-0" />
          <div id="mcp-panel-root" className="flex h-full min-w-0" />
          <div id="agents-panel-root" className="flex h-full min-w-0" />
          <div id="output-styles-panel-root" className="flex h-full min-w-0" />
          {/* Config group — Permissions (control the allow/ask/deny rules). */}
          <div id="permissions-panel-root" className="flex h-full min-w-0" />
          {/* The independent Preview panel's own portal root — the in-app live
              view of a project's dev server, open alongside everything else. */}
          <div id="preview-panel-root" className="flex h-full min-w-0" />
          {/* The KPI library panel — the Fleet dashboard's metric catalog, on the
              skills-panel push-in standard. */}
          <div id="kpi-panel-root" className="flex h-full min-w-0" />
          {/* The independent Changelog panel's own portal root — a peer that can
              sit open alongside the route panel, the planner, the API, and the plugins. */}
          <div id="changelog-panel-root" className="flex h-full min-w-0" />
          {/* Standalone review panels mirroring @panel/(activity) — Components/Projects/To Do. */}
          <div id="components-panel-root" className="flex h-full min-w-0" />
          <div id="projects-panel-root" className="flex h-full min-w-0" />
          <div id="todo-panel-root" className="flex h-full min-w-0" />
          {/* Agent Teams — the live team roster + the shared task list, both on
              the skills-panel push-in standard (read straight off ~/.claude/teams
              + ~/.claude/tasks). */}
          <div id="teams-panel-root" className="flex h-full min-w-0" />
          <div id="tasks-panel-root" className="flex h-full min-w-0" />
          {/* GitHub Issues — a Changelog sibling (gh-backed), read straight from
              the repo's issue tracker. */}
          <div id="issues-panel-root" className="flex h-full min-w-0" />
        </div>
        {/* ⌘K launcher — portals to <body>; mounted here so it has the sidebar /
            planner / text-editor contexts its commands drive. */}
        <CommandPalette />
        {/* Performs terminal drag-reorder (hears the boundary chips' drop event). */}
        <Suspense fallback={null}>
          <ReorderListener />
        </Suspense>
      </SidebarProvider>

      <PanelWrapper panel={panel} />
      <PlannerPanel />
      <ApiPanel />
      <PluginsPanel />
      <SkillsPanel />
      <KpiPanel />
      <CommandsPanel />
      <HooksPanel />
      <McpPanel />
      <AgentsPanel />
      <OutputStylesPanel />
      <PermissionsPanel />
      <PreviewPanel />
      <ChangelogPanel />
      <ComponentsPanel />
      <ProjectsPanel />
      <TodoPanel />
      <TeamsPanel />
      <TasksPanel />
      <IssuesPanel />
      <TextEditor />
      </TextEditorProvider>
      </IssuesProvider>
      </TasksProvider>
      </TeamsProvider>
      </TodoPanelProvider>
      </ProjectsPanelProvider>
      </ComponentsPanelProvider>
      </ChangelogProvider>
      </PreviewProvider>
      </PermissionsProvider>
      </OutputStylesProvider>
      </AgentsProvider>
      </McpProvider>
      </HooksProvider>
      </CommandsProvider>
      </KpiProvider>
      </SkillsProvider>
      </PluginsProvider>
      </ApiProvider>
      </PlannerProvider>
      </FocusProvider>
      </CommandProvider>
    </div>
  );
}

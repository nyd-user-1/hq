import { Suspense } from "react";
import { cookies } from "next/headers";
import Boundary from "@/app/ui/boundary";
import Sidebar from "@/app/ui/sidebar";
import SidebarColumn from "@/app/ui/sidebar-column";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import { SidebarProvider } from "@/app/ui/sidebar-state";
import Terminal from "@/app/ui/terminal";
import PanelWrapper from "@/app/ui/panel-wrapper";
import TerminalRow from "@/app/ui/terminal-row";
import FilesOverlay from "@/app/ui/files-overlay";
import FleetOverlay from "@/app/ui/fleet-overlay";
import { PlannerProvider } from "@/app/ui/planner-state";
import PlannerPanel from "@/app/ui/planner-panel";
import { ApiProvider } from "@/app/ui/api-state";
import ApiPanel from "@/app/ui/api-panel";
import { PluginsProvider } from "@/app/ui/plugins-state";
import PluginsPanel from "@/app/ui/plugins-panel";
import { SkillsProvider } from "@/app/ui/skills-state";
import SkillsPanel from "@/app/ui/skills-panel";
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
import { TextEditorProvider } from "@/app/ui/text-editor-state";
import TextEditor from "@/app/ui/text-editor";
import { CommandProvider } from "@/app/ui/command-state";
import CommandPalette from "@/app/ui/command-palette";

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
      <PlannerProvider>
      <ApiProvider>
      <PluginsProvider>
      <SkillsProvider>
      <CommandsProvider>
      <HooksProvider>
      <McpProvider>
      <AgentsProvider>
      <OutputStylesProvider>
      <PermissionsProvider>
      <PreviewProvider>
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
              <Boundary label="terminal.tsx" lead={<SidebarToggle />}>
                <Suspense
                  fallback={
                    <p className="text-sm text-zinc-600">loading terminal…</p>
                  }
                >
                  <Terminal initialFocus={focusDefault} />
                </Suspense>
              </Boundary>
            </TerminalRow>
            {children}
            {/* Files browser — covers the center when ?center=files; the terminal
                stays mounted + live behind it. Suspense for useSearchParams. */}
            <Suspense fallback={null}>
              <FilesOverlay />
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
        </div>
        {/* ⌘K launcher — portals to <body>; mounted here so it has the sidebar /
            planner / text-editor contexts its commands drive. */}
        <CommandPalette />
      </SidebarProvider>

      <PanelWrapper panel={panel} />
      <PlannerPanel />
      <ApiPanel />
      <PluginsPanel />
      <SkillsPanel />
      <CommandsPanel />
      <HooksPanel />
      <McpPanel />
      <AgentsPanel />
      <OutputStylesPanel />
      <PermissionsPanel />
      <PreviewPanel />
      <TextEditor />
      </TextEditorProvider>
      </PreviewProvider>
      </PermissionsProvider>
      </OutputStylesProvider>
      </AgentsProvider>
      </McpProvider>
      </HooksProvider>
      </CommandsProvider>
      </SkillsProvider>
      </PluginsProvider>
      </ApiProvider>
      </PlannerProvider>
      </CommandProvider>
    </div>
  );
}

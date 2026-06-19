import { Suspense } from "react";
import { cookies } from "next/headers";
import Boundary from "@/app/ui/boundary";
import Sidebar from "@/app/ui/sidebar";
import SidebarColumn from "@/app/ui/sidebar-column";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import { SidebarProvider } from "@/app/ui/sidebar-state";
import Terminal from "@/app/ui/terminal";
import SearchTrigger from "@/app/ui/search-trigger";
import PanelWrapper from "@/app/ui/panel-wrapper";
import PairColumn from "@/app/ui/pair-column";
import { PlannerProvider } from "@/app/ui/planner-state";
import PlannerPanel from "@/app/ui/planner-panel";
import { ApiProvider } from "@/app/ui/api-state";
import ApiPanel from "@/app/ui/api-panel";
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
  // Seed the sidebar from its cookie so a refresh keeps the last open/closed
  // state (default open on a first visit). Read on the server → no flash.
  const sidebarOpen = (await cookies()).get("hq-sidebar")?.value !== "0";
  return (
    <div className="flex h-dvh flex-col bg-zinc-950 p-6 text-zinc-100">
      {/* no row gap — the sidebar carries mr-4 while open (collapses with it)
          and the app panel brings its own ml-4, so closed = truly full width */}
      <CommandProvider>
      <PlannerProvider>
      <ApiProvider>
      <TextEditorProvider>
      <SidebarProvider initialOpen={sidebarOpen}>
        <div className="flex min-h-0 flex-1">
          <SidebarColumn>
            <Boundary label="sidebar.tsx" padX="px-2.5">
              <Sidebar />
            </Boundary>
          </SidebarColumn>

          {/* The protected column: a min-width floor so opening the sidebar
              squeezes the PANEL (which can shrink), not the terminal. */}
          <div className="flex min-w-[380px] flex-1 flex-col gap-4">
            {/* WIREFRAME: PairColumn keeps Terminal 1 always-first so it never
                remounts; ?pair=<id> adds a mock Terminal 2 pane beside it. */}
            <PairColumn>
              <Boundary
                label="terminal.tsx"
                lead={<SidebarToggle />}
                trail={<SearchTrigger />}
              >
                <Suspense
                  fallback={
                    <p className="text-sm text-zinc-600">loading terminal…</p>
                  }
                >
                  <Terminal />
                </Suspense>
              </Boundary>
            </PairColumn>
            {children}
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
        </div>
        {/* ⌘K launcher — portals to <body>; mounted here so it has the sidebar /
            planner / text-editor contexts its commands drive. */}
        <CommandPalette />
      </SidebarProvider>

      <PanelWrapper panel={panel} />
      <PlannerPanel />
      <ApiPanel />
      <TextEditor />
      </TextEditorProvider>
      </ApiProvider>
      </PlannerProvider>
      </CommandProvider>
    </div>
  );
}

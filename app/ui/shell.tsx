import { Suspense } from "react";
import Boundary from "@/app/ui/boundary";
import Sidebar from "@/app/ui/sidebar";
import SidebarColumn from "@/app/ui/sidebar-column";
import SidebarToggle from "@/app/ui/sidebar-toggle";
import { SidebarProvider } from "@/app/ui/sidebar-state";
import Terminal from "@/app/ui/terminal";
import PanelWrapper from "@/app/ui/panel-wrapper";

// Full-screen OS shell. LAYOUT.TSX wraps three peers: SIDEBAR (left, 210px),
// TERMINAL (center, always mounted — the persistent heart), and the right
// app-panel portal anchor. The terminal lives here (root layout) so it never
// unmounts as the sidebar navigates the panel. Server component: it renders the
// client Sidebar/PanelWrapper and the (client) Terminal island as children.
export default function Shell({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-zinc-950 p-3 text-zinc-100 lg:p-4">
      <Boundary label="layout.tsx">
        {/* no row gap — the sidebar carries mr-4 while open (collapses with it)
            and the app panel brings its own ml-4, so closed = truly full width */}
        <SidebarProvider>
          <div className="flex min-h-0 flex-1">
            <SidebarColumn>
              <Boundary label="sidebar.tsx">
                <Sidebar />
              </Boundary>
            </SidebarColumn>

            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Boundary label="terminal.tsx" lead={<SidebarToggle />}>
                <Suspense
                  fallback={
                    <p className="text-sm text-zinc-600">loading terminal…</p>
                  }
                >
                  <Terminal />
                </Suspense>
              </Boundary>
              {children}
            </div>

            <div id="app-panel-root" className="flex h-full shrink-0" />
          </div>
        </SidebarProvider>
      </Boundary>

      <PanelWrapper panel={panel} />
    </div>
  );
}

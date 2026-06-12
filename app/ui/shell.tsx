import { Suspense } from "react";
import Boundary from "@/app/ui/boundary";
import Sidebar from "@/app/ui/sidebar";
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
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex w-[210px] shrink-0">
            <Boundary label="sidebar.tsx">
              <Sidebar />
            </Boundary>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <Boundary label="terminal.tsx">
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
      </Boundary>

      <PanelWrapper panel={panel} />
    </div>
  );
}

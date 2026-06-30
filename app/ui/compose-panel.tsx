"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import ComposeTray from "@/app/ui/compose-tray";
import { useCompose } from "@/app/ui/compose-state";

// hq's Compose panel — a standalone client-state portal (its own root
// #compose-panel-root), mirroring the Changelog / Skills panels: AppPanel chrome
// wrapping the existing ComposeTray verbatim. The tray is fully self-contained —
// it gathers dropped artifacts and dispatches the hq:compose window event the
// terminal listens for — so the panel is pure chrome around it.
export default function ComposePanel() {
  const { open, setOpen } = useCompose();
  return (
    <AppPanel
      rootId="compose-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="compose-panel.tsx">
        <ComposeTray />
      </Boundary>
    </AppPanel>
  );
}

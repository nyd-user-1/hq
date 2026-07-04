"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useTools, TOOLS_PANELS } from "@/app/ui/tools-state";
import ToolsSwitchChip from "@/app/ui/tools-switch-chip";
import ToolsNavChips from "@/app/ui/tools-nav-chips";
import ComposePanel from "@/app/ui/compose-panel";
import PreviewPanel from "@/app/ui/preview-panel";
import TextEditorPanel from "@/app/ui/text-editor-panel";
import TreePanel from "@/app/ui/tree-panel";

// The Tools container — ONE push-in panel that hosts the Tools panels (Compose ·
// Preview · Text · Tree) and swaps between them IN PLACE. Mirrors console-panel.tsx:
// the switcher rides the boundary after the file-path chip; picking a panel changes
// `active`, which re-keys the Boundary (flash replays) and swaps the chip label to
// that panel's file. Each panel renders content-only via its `embedded` prop (this
// container owns the AppPanel + Boundary).
export default function ToolsPanel() {
  const { open, setOpen, active, setActive } = useTools();
  const meta = TOOLS_PANELS.find((p) => p.key === active) ?? TOOLS_PANELS[0];

  return (
    <AppPanel rootId="tools-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={<ToolsSwitchChip file={meta.file} active={active} onSelect={setActive} />}
        trail={<ToolsNavChips active={active} onSelect={setActive} />}
      >
        {active === "compose" && <ComposePanel embedded />}
        {active === "preview" && <PreviewPanel embedded />}
        {active === "text" && <TextEditorPanel embedded />}
        {active === "tree" && <TreePanel embedded />}
      </Boundary>
    </AppPanel>
  );
}

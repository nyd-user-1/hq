"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useTools, TOOLS_PANELS, type ToolsKey } from "@/app/ui/tools-state";
import GroupSwitchChip from "@/app/ui/group-switch-chip";
import GroupNavChips from "@/app/ui/group-nav-chips";
import ComposePanel from "@/app/ui/compose-panel";
import PreviewPanel from "@/app/ui/preview-panel";
import TextEditorPanel from "@/app/ui/text-editor-panel";
import TreePanel from "@/app/ui/tree-panel";
import { useCompose } from "@/app/ui/compose-state";
import { usePreview } from "@/app/ui/preview-state";
import { useTextEditor } from "@/app/ui/text-editor-state";
import { useTree } from "@/app/ui/tree-state";

// The Tools container — ONE push-in panel hosting Compose · Preview · Text · Tree,
// swapping between them in place via the shared GroupSwitchChip + GroupNavChips.
export default function ToolsPanel() {
  const { open, setOpen, active, setActive } = useTools();
  const meta = TOOLS_PANELS.find((p) => p.key === active) ?? TOOLS_PANELS[0];
  const standalone: Record<string, (v: boolean) => void> = {
    compose: useCompose().setOpen,
    preview: usePreview().setOpen,
    text: useTextEditor().setOpen,
    tree: useTree().setOpen,
  };
  const select = (k: string) => setActive(k as ToolsKey);

  return (
    <AppPanel rootId="tools-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={<GroupSwitchChip file={meta.file} active={active} members={TOOLS_PANELS} onSelect={select} onPopOut={(k) => standalone[k](true)} />}
        trail={<GroupNavChips active={active} members={TOOLS_PANELS} onSelect={select} />}
      >
        {active === "compose" && <ComposePanel embedded />}
        {active === "preview" && <PreviewPanel embedded />}
        {active === "text" && <TextEditorPanel embedded />}
        {active === "tree" && <TreePanel embedded />}
      </Boundary>
    </AppPanel>
  );
}

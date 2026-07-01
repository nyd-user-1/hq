"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useConsole, CONSOLE_PANELS } from "@/app/ui/console-state";
import ConsoleSwitchChip from "@/app/ui/console-switch-chip";
import CommandsPanel from "@/app/ui/commands-panel";
import SkillsPanel from "@/app/ui/skills-panel";
import PluginsPanel from "@/app/ui/plugins-panel";
import RoutinesPanel from "@/app/ui/routines-panel";
import HooksPanel from "@/app/ui/hooks-panel";
import McpPanel from "@/app/ui/mcp-panel";
import AgentsPanel from "@/app/ui/agents-panel";
import OutputStylesPanel from "@/app/ui/output-styles-panel";

// The Console container — ONE push-in panel that hosts all eight console panels and
// swaps between them IN PLACE. The "⌄" switcher rides the boundary after the
// file-path chip; picking a panel changes `active`, which (a) re-keys the Boundary
// so the boundary-flash blue animation replays — a replace, not a slide/push — and
// (b) swaps the chip label to that panel's file. Each panel is reused untouched via
// its additive `embedded` prop (renders content only; this owns AppPanel + Boundary).
export default function ConsolePanel() {
  const { open, setOpen, active, setActive } = useConsole();
  const meta = CONSOLE_PANELS.find((p) => p.key === active) ?? CONSOLE_PANELS[0];

  return (
    <AppPanel rootId="console-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        trail={<ConsoleSwitchChip active={active} onSelect={setActive} />}
      >
        {active === "commands" && <CommandsPanel embedded />}
        {active === "skills" && <SkillsPanel embedded />}
        {active === "plugins" && <PluginsPanel embedded />}
        {active === "routines" && <RoutinesPanel embedded />}
        {active === "hooks" && <HooksPanel embedded />}
        {active === "mcp" && <McpPanel embedded />}
        {active === "agents" && <AgentsPanel embedded />}
        {active === "outputStyles" && <OutputStylesPanel embedded />}
      </Boundary>
    </AppPanel>
  );
}

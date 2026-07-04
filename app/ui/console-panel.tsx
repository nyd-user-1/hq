"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useConsole, CONSOLE_PANELS, type ConsoleKey } from "@/app/ui/console-state";
import GroupSwitchChip from "@/app/ui/group-switch-chip";
import GroupNavChips from "@/app/ui/group-nav-chips";
import CommandsPanel from "@/app/ui/commands-panel";
import SkillsPanel from "@/app/ui/skills-panel";
import PluginsPanel from "@/app/ui/plugins-panel";
import RoutinesPanel from "@/app/ui/routines-panel";
import HooksPanel from "@/app/ui/hooks-panel";
import McpPanel from "@/app/ui/mcp-panel";
import AgentsPanel from "@/app/ui/agents-panel";
import OutputStylesPanel from "@/app/ui/output-styles-panel";
import { useAgents } from "@/app/ui/agents-state";
import { useCommands } from "@/app/ui/commands-state";
import { useHooks } from "@/app/ui/hooks-state";
import { useMcp } from "@/app/ui/mcp-state";
import { useOutputStyles } from "@/app/ui/output-styles-state";
import { usePlugins } from "@/app/ui/plugins-state";
import { useRoutines } from "@/app/ui/routines-state";
import { useSkills } from "@/app/ui/skills-state";

// The Console container — ONE push-in panel that hosts all eight console panels and
// swaps between them IN PLACE via the shared GroupSwitchChip (dropdown) + GroupNavChips
// (‹ ›). Each panel renders content-only via its `embedded` prop; this owns the
// AppPanel + Boundary. The "↗" pops a member out as its own standalone (the map below).
export default function ConsolePanel() {
  const { open, setOpen, active, setActive } = useConsole();
  const meta = CONSOLE_PANELS.find((p) => p.key === active) ?? CONSOLE_PANELS[0];
  const standalone: Record<string, (v: boolean) => void> = {
    agents: useAgents().setOpen,
    commands: useCommands().setOpen,
    hooks: useHooks().setOpen,
    mcp: useMcp().setOpen,
    outputStyles: useOutputStyles().setOpen,
    plugins: usePlugins().setOpen,
    routines: useRoutines().setOpen,
    skills: useSkills().setOpen,
  };
  const select = (k: string) => setActive(k as ConsoleKey);

  return (
    <AppPanel rootId="console-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={<GroupSwitchChip file={meta.file} active={active} members={CONSOLE_PANELS} onSelect={select} onPopOut={(k) => standalone[k](true)} />}
        trail={<GroupNavChips active={active} members={CONSOLE_PANELS} onSelect={select} />}
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

"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useTeamsGroup, TEAMS_GROUP_PANELS, type TeamsGroupKey } from "@/app/ui/teams-group-state";
import GroupSwitchChip from "@/app/ui/group-switch-chip";
import GroupNavChips from "@/app/ui/group-nav-chips";
import TeamsPanel from "@/app/ui/teams-panel";
import MailboxPanel from "@/app/ui/mailbox-panel";
import { useTeams } from "@/app/ui/teams-state";
import { useMailbox } from "@/app/ui/mailbox-state";

// The Teams container — Teams (roster) · Mailbox, swapping in place via the shared
// GroupSwitchChip + GroupNavChips. Opened from the terminal split menu's Agent Teams.
export default function TeamsGroupPanel() {
  const { open, setOpen, active, setActive } = useTeamsGroup();
  const meta = TEAMS_GROUP_PANELS.find((p) => p.key === active) ?? TEAMS_GROUP_PANELS[0];
  const standalone: Record<string, (v: boolean) => void> = {
    teams: useTeams().setOpen,
    mailbox: useMailbox().setOpen,
  };
  const select = (k: string) => setActive(k as TeamsGroupKey);

  return (
    <AppPanel rootId="teams-group-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={<GroupSwitchChip file={meta.file} active={active} members={TEAMS_GROUP_PANELS} onSelect={select} onPopOut={(k) => standalone[k](true)} />}
        trail={<GroupNavChips active={active} members={TEAMS_GROUP_PANELS} onSelect={select} />}
      >
        {active === "teams" && <TeamsPanel embedded />}
        {active === "mailbox" && <MailboxPanel embedded />}
      </Boundary>
    </AppPanel>
  );
}

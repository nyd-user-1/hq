"use client";

import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useConfig, CONFIG_PANELS, type ConfigKey } from "@/app/ui/config-state";
import GroupSwitchChip from "@/app/ui/group-switch-chip";
import GroupNavChips from "@/app/ui/group-nav-chips";
import PermissionsPanel from "@/app/ui/permissions-panel";
import SettingsPanel from "@/app/ui/settings-panel";
import EnvironmentPanel from "@/app/ui/environment-panel";
import TrustedFoldersPanel from "@/app/ui/trusted-folders-panel";
import { usePermissions } from "@/app/ui/permissions-state";
import { useSettings } from "@/app/ui/settings-state";
import { useEnvironment } from "@/app/ui/environment-state";
import { useTrustedFolders } from "@/app/ui/trusted-folders-state";

// The Config container — Permissions · Settings · Environment · Trusted Folders,
// swapping in place via the shared GroupSwitchChip + GroupNavChips. Opened from the
// account-chip pop-up.
export default function ConfigPanel() {
  const { open, setOpen, active, setActive } = useConfig();
  const meta = CONFIG_PANELS.find((p) => p.key === active) ?? CONFIG_PANELS[0];
  const standalone: Record<string, (v: boolean) => void> = {
    permissions: usePermissions().setOpen,
    settings: useSettings().setOpen,
    environment: useEnvironment().setOpen,
    trusted: useTrustedFolders().setOpen,
  };
  const select = (k: string) => setActive(k as ConfigKey);

  return (
    <AppPanel rootId="config-panel-root" open={open} onClose={() => setOpen(false)}>
      <Boundary
        key={active}
        label={meta.file}
        chip={<GroupSwitchChip file={meta.file} active={active} members={CONFIG_PANELS} onSelect={select} onPopOut={(k) => standalone[k](true)} />}
        trail={<GroupNavChips active={active} members={CONFIG_PANELS} onSelect={select} />}
      >
        {active === "permissions" && <PermissionsPanel embedded />}
        {active === "settings" && <SettingsPanel embedded />}
        {active === "environment" && <EnvironmentPanel embedded />}
        {active === "trusted" && <TrustedFoldersPanel embedded />}
      </Boundary>
    </AppPanel>
  );
}

"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/active state for the Config container (config-panel.tsx) — ONE push-in panel
// hosting Permissions · Settings · Environment · Trusted Folders, swapping between
// them in place. Mirrors console-state.tsx. Triggered from the account-chip pop-up.
export type ConfigKey = "permissions" | "settings" | "environment" | "trusted";

export const CONFIG_PANELS: { key: ConfigKey; title: string; file: string }[] = [
  { key: "permissions", title: "Permissions", file: "permissions-panel.tsx" },
  { key: "settings", title: "Settings", file: "settings-panel.tsx" },
  { key: "environment", title: "Environment", file: "environment-panel.tsx" },
  { key: "trusted", title: "Trusted Folders", file: "trusted-folders-panel.tsx" },
];

const KEYS = CONFIG_PANELS.map((p) => p.key) as string[];
function isKey(v: string | null): v is ConfigKey {
  return !!v && KEYS.includes(v);
}

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  active: ConfigKey;
  setActive: (k: ConfigKey) => void;
  openAt: (k: ConfigKey) => void;
};

const ConfigContext = createContext<Ctx | null>(null);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ConfigKey>("permissions");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-config") === "1");
      const a = localStorage.getItem("hq-config-active");
      if (isKey(a)) setActive(a);
    } catch {
      /* no storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-config", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem("hq-config-active", active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <ConfigContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
        active,
        setActive,
        openAt: (k) => {
          setActive(k);
          setOpen(true);
        },
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): Ctx {
  return (
    useContext(ConfigContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      active: "permissions",
      setActive: () => {},
      openAt: () => {},
    }
  );
}

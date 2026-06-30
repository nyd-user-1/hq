"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the Settings panel — a read-only viewer of
// ~/.claude/settings.json, its own #settings-panel-root portal. Persisted to
// localStorage (key "hq-settings"). Mirrors permissions-state / changelog-state.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-settings") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-settings", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <SettingsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): Ctx {
  return (
    useContext(SettingsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

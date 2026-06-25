"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Plugins panel — HQ's library of Claude
// Code agent plugins (ponytail, caveman, …) you toggle on/off instead of cloning
// repos. Like the API + Planner panels it lives in its OWN portal root
// (#plugins-panel-root) driven by this client state — orthogonal to the
// URL-routed @panel — so the library can sit open alongside Activity/Search/etc.
// Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const PluginsContext = createContext<Ctx | null>(null);

export function PluginsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-plugins") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-plugins", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <PluginsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </PluginsContext.Provider>
  );
}

export function usePlugins(): Ctx {
  return (
    useContext(PluginsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

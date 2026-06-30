"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Environment panel — a sibling of the
// Skills / Permissions panels (its own #environment-panel-root portal, driven by
// this client state, orthogonal to the URL-routed @panel). Surfaces the safe
// allowlist of process.env. Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const EnvironmentContext = createContext<Ctx | null>(null);

export function EnvironmentProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-environment") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-environment", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <EnvironmentContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment(): Ctx {
  return (
    useContext(EnvironmentContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

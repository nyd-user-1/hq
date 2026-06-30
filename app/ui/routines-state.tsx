"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Routines panel — a sibling of the Skills /
// Changelog panels (its own #routines-panel-root portal, driven by this client
// state) as the console panels migrate out of @panel/(console). Persisted to
// localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const RoutinesContext = createContext<Ctx | null>(null);

export function RoutinesProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-routines") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-routines", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <RoutinesContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </RoutinesContext.Provider>
  );
}

export function useRoutines(): Ctx {
  return (
    useContext(RoutinesContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Teams panel — a sibling of the Skills
// panel (its own #teams-panel-root portal, driven by this client state). Lists
// the active agent teams spawned from Claude Code sessions. Persisted to
// localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const TeamsContext = createContext<Ctx | null>(null);

export function TeamsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-teams") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-teams", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <TeamsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </TeamsContext.Provider>
  );
}

export function useTeams(): Ctx {
  return (
    useContext(TeamsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

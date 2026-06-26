"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Skills panel — a sibling of the Plugins
// panel (its own #skills-panel-root portal, driven by this client state) and the
// first step in migrating the console panels out of @panel/(console). Persisted
// to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const SkillsContext = createContext<Ctx | null>(null);

export function SkillsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-skills") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-skills", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <SkillsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </SkillsContext.Provider>
  );
}

export function useSkills(): Ctx {
  return (
    useContext(SkillsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Agents panel — a sibling of the Skills /
// Commands panels (its own #agents-panel-root portal). Persisted to localStorage.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const AgentsContext = createContext<Ctx | null>(null);

export function AgentsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-agents") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-agents", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <AgentsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </AgentsContext.Provider>
  );
}

export function useAgents(): Ctx {
  return (
    useContext(AgentsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

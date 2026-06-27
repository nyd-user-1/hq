"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Hooks panel — a sibling of the Skills /
// Commands panels (its own #hooks-panel-root portal). Persisted to localStorage.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const HooksContext = createContext<Ctx | null>(null);

export function HooksProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-hooks") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-hooks", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <HooksContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </HooksContext.Provider>
  );
}

export function useHooks(): Ctx {
  return (
    useContext(HooksContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

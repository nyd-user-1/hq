"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Output Styles panel — a sibling of the
// Skills / Commands panels (its own #output-styles-panel-root portal). Persisted.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const OutputStylesContext = createContext<Ctx | null>(null);

export function OutputStylesProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-output-styles") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-output-styles", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <OutputStylesContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </OutputStylesContext.Provider>
  );
}

export function useOutputStyles(): Ctx {
  return (
    useContext(OutputStylesContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

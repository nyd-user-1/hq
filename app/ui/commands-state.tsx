"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Commands panel — sibling of the Skills and
// Plugins panels (its own #commands-panel-root portal). Part of migrating the
// console panels out of @panel/(console). Persisted to localStorage.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const CommandsContext = createContext<Ctx | null>(null);

export function CommandsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-commands") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-commands", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <CommandsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </CommandsContext.Provider>
  );
}

export function useCommands(): Ctx {
  return (
    useContext(CommandsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

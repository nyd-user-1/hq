"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Savings panel — a sibling of the Skills /
// Changelog panels (its own #savings-panel-root portal, driven by this client
// state) migrated out of @panel/(metrics)/savings. Orthogonal to the URL-routed
// @panel so it can sit open alongside Activity/Search/etc. Persisted to
// localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const SavingsContext = createContext<Ctx | null>(null);

export function SavingsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-savings") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-savings", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <SavingsContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </SavingsContext.Provider>
  );
}

export function useSavings(): Ctx {
  return (
    useContext(SavingsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

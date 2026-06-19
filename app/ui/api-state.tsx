"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent API (usage) panel. Like the planner it
// lives in its OWN portal root (#api-panel-root) driven by this client state —
// orthogonal to the URL-routed @panel — so the usage meters can stay open AT THE
// SAME TIME as Activity/Search/Planner. Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const ApiContext = createContext<Ctx | null>(null);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-api") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-api", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <ApiContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi(): Ctx {
  return (
    useContext(ApiContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

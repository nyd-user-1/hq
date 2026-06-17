"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the independent Batch Planner panel. It lives in its OWN
// portal root (#planner-panel-root) driven by this client state — orthogonal to
// the URL-routed @panel — so the planner can be open AT THE SAME TIME as Activity
// or Search. Persisted to localStorage so a refresh keeps it.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const PlannerContext = createContext<Ctx | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-planner") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-planner", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <PlannerContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </PlannerContext.Provider>
  );
}

export function usePlanner(): Ctx {
  return (
    useContext(PlannerContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

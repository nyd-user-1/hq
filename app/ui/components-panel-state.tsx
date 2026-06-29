"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Components panel — the skills-panel push-in
// standard. A root-level #components-panel-root portal driven by this client state,
// orthogonal to the URL-routed @panel/components (which still exists during the
// review period). Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const ComponentsPanelContext = createContext<Ctx | null>(null);

export function ComponentsPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-components-panel") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-components-panel", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <ComponentsPanelContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </ComponentsPanelContext.Provider>
  );
}

export function useComponentsPanel(): Ctx {
  return (
    useContext(ComponentsPanelContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Tree panel — the single-pane agent
// hierarchy (sessions → nested subagents, background/dispatched agents, agent
// teams). Like the Changelog / Skills / Plugins panels it lives in its OWN
// portal root (#tree-panel-root) driven by this client state — orthogonal to the
// URL-routed @panel — so it can sit open alongside Activity/Search/etc.
// Persisted to localStorage ("hq-tree") across reloads.
type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const TreeContext = createContext<Ctx | null>(null);

export function TreeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-tree") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-tree", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <TreeContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </TreeContext.Provider>
  );
}

export function useTree(): Ctx {
  return (
    useContext(TreeContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

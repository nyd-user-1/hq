"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Projects panel — the skills-panel push-in
// standard. A root-level #projects-panel-root portal driven by this client state,
// orthogonal to the URL-routed @panel/projects (which still exists during the
// review period). Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const ProjectsPanelContext = createContext<Ctx | null>(null);

export function ProjectsPanelProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-projects-panel") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-projects-panel", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <ProjectsPanelContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </ProjectsPanelContext.Provider>
  );
}

export function useProjectsPanel(): Ctx {
  return (
    useContext(ProjectsPanelContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

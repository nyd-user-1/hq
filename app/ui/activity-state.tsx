"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/active state for the Activity container (activity-panel.tsx) — ONE push-in
// panel that hosts the Activity panels (Projects · To Do · Components · Changelog ·
// Issues · Tasks) and swaps between them in place. Direct mirror of console-state.tsx.
// Both the open flag and the active panel persist to localStorage.

export type ActivityKey =
  | "projects"
  | "todos"
  | "components"
  | "changelog"
  | "issues"
  | "tasks";

// Order here IS the dropdown order (the requested ordering, not A–Z). find-by-key
// everywhere else, so this stays display-only.
export const ACTIVITY_PANELS: { key: ActivityKey; title: string; file: string }[] = [
  { key: "projects", title: "Projects", file: "projects-panel.tsx" },
  { key: "todos", title: "To Do", file: "todo-panel.tsx" },
  { key: "components", title: "Components", file: "components-panel.tsx" },
  { key: "changelog", title: "Changelog", file: "changelog-panel.tsx" },
  { key: "issues", title: "Issues", file: "issues-panel.tsx" },
  { key: "tasks", title: "Tasks", file: "tasks-panel.tsx" },
];

const KEYS = ACTIVITY_PANELS.map((p) => p.key) as string[];
function isKey(v: string | null): v is ActivityKey {
  return !!v && KEYS.includes(v);
}

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  active: ActivityKey;
  setActive: (k: ActivityKey) => void;
  openAt: (k: ActivityKey) => void; // set active + open — the nav entry point
};

const ActivityContext = createContext<Ctx | null>(null);

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ActivityKey>("projects");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-activity") === "1");
      const a = localStorage.getItem("hq-activity-active");
      if (isKey(a)) setActive(a);
    } catch {
      /* no storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-activity", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem("hq-activity-active", active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <ActivityContext.Provider
      value={{
        open,
        setOpen,
        toggle: () => setOpen((v) => !v),
        active,
        setActive,
        openAt: (k) => {
          setActive(k);
          setOpen(true);
        },
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity(): Ctx {
  return (
    useContext(ActivityContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      active: "projects",
      setActive: () => {},
      openAt: () => {},
    }
  );
}

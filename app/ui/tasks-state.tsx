"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone Tasks panel — a sibling of the Teams
// panel (its own #tasks-panel-root portal, driven by this client state). Drills
// into the task list for a team (the active team id is stashed in localStorage
// "hq-tasks-team" by the Teams panel). Persisted to localStorage across reloads.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const TasksContext = createContext<Ctx | null>(null);

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-tasks") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-tasks", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <TasksContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </TasksContext.Provider>
  );
}

export function useTasks(): Ctx {
  return (
    useContext(TasksContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

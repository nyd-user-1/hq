"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { MetricDef } from "@/lib/fleet";

// Shared state for the Fleet dashboard, so the root-level kpi-panel (the metric
// LIBRARY, a skills-panel-style push-in) and the center board (fleet-view) stay in
// sync. Holds: the panel open/close, the board composition (placed metric ids +
// the live catalog), and the SCOPE (project + multi-selected sessions). Panel-open
// and the placed set persist to localStorage; scope is ephemeral view state.

export type KpiCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  placed: string[] | null; // null = not bootstrapped (adopt the server default once)
  setPlaced: (ids: string[]) => void;
  addMetric: (id: string) => void;
  removeMetric: (id: string) => void;
  catalog: MetricDef[];
  setCatalog: (c: MetricDef[]) => void;
  project: string | null; // null = all projects
  setProject: (p: string | null) => void;
  sessions: string[]; // [] = all sessions; >1 = a multi-session scope
  setSessions: (s: string[]) => void;
};

const Ctx = createContext<KpiCtx | null>(null);
const PLACED = "hq-fleet-placed";
const OPEN = "hq-kpis";

export function KpiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placed, setPlacedState] = useState<string[] | null>(null);
  const [catalog, setCatalog] = useState<MetricDef[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN) === "1");
      const s = JSON.parse(localStorage.getItem(PLACED) || "null");
      if (Array.isArray(s)) setPlacedState(s);
    } catch {
      /* no storage */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  const writePlaced = (ids: string[]) => {
    setPlacedState(ids);
    try {
      localStorage.setItem(PLACED, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  };

  const value: KpiCtx = {
    open,
    setOpen,
    toggle: () => setOpen((v) => !v),
    placed,
    setPlaced: writePlaced,
    addMetric: (id) =>
      setPlacedState((p) => {
        const cur = p ?? [];
        if (cur.includes(id)) return cur;
        const next = [...cur, id];
        try {
          localStorage.setItem(PLACED, JSON.stringify(next));
        } catch {}
        return next;
      }),
    removeMetric: (id) =>
      setPlacedState((p) => {
        const next = (p ?? []).filter((x) => x !== id);
        try {
          localStorage.setItem(PLACED, JSON.stringify(next));
        } catch {}
        return next;
      }),
    catalog,
    setCatalog,
    project,
    setProject,
    sessions,
    setSessions,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKpis(): KpiCtx {
  return (
    useContext(Ctx) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      placed: null,
      setPlaced: () => {},
      addMetric: () => {},
      removeMetric: () => {},
      catalog: [],
      setCatalog: () => {},
      project: null,
      setProject: () => {},
      sessions: [],
      setSessions: () => {},
    }
  );
}

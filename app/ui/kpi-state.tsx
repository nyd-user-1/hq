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
  views: SavedView[]; // user-saved board compositions (persisted)
  saveView: (name: string) => void;
  deleteView: (name: string) => void;
  viewName: string; // the active view's name ("Custom" once manually edited)
  applyView: (v: SavedView) => void;
};

export type SavedView = { name: string; ids: string[] };

// Four recommended starting boards, seeded into the save menu + the kpi-panel.
export const RECOMMENDED_VIEWS: SavedView[] = [
  { name: "Overview", ids: ["f_sessions", "f_tokens", "f_turns", "f_projects", "todos_pending", "f_cliff", "tokens_day", "tokens_by_project", "sessions_by_context", "model_usage"] },
  { name: "Cost & burn", ids: ["f_spend", "f_tokens", "f_cliff", "tokens_stacked_area", "tokens_day_area", "sessions_by_context", "tokens_per_session"] },
  { name: "Session deep-dive", ids: ["s_turns", "s_user", "s_claude", "s_ctx_left", "s_total_time", "context_burn", "tokens_by_turn", "time_per_turn", "tools_used", "turn_time_box"] },
  { name: "Projects & trends", ids: ["f_projects", "tokens_by_project", "sessions_per_project", "tokens_sparklines", "sessions_calendar", "sessions_gantt", "sessions_timeline"] },
];

const Ctx = createContext<KpiCtx | null>(null);
const PLACED = "hq-fleet-placed";
const OPEN = "hq-kpis";
const VIEWS = "hq-fleet-views";

export function KpiProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placed, setPlacedState] = useState<string[] | null>(null);
  const [catalog, setCatalog] = useState<MetricDef[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("Overview");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN) === "1");
      const s = JSON.parse(localStorage.getItem(PLACED) || "null");
      if (Array.isArray(s)) setPlacedState(s);
      const v = JSON.parse(localStorage.getItem(VIEWS) || "null");
      if (Array.isArray(v)) setViews(v);
    } catch {
      /* no storage */
    }
  }, []);

  const writeViews = (v: SavedView[]) => {
    setViews(v);
    try {
      localStorage.setItem(VIEWS, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
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
    addMetric: (id) => {
      setViewName("Custom");
      setPlacedState((p) => {
        const cur = p ?? [];
        if (cur.includes(id)) return cur;
        const next = [...cur, id];
        try {
          localStorage.setItem(PLACED, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    removeMetric: (id) => {
      setViewName("Custom");
      setPlacedState((p) => {
        const next = (p ?? []).filter((x) => x !== id);
        try {
          localStorage.setItem(PLACED, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    catalog,
    setCatalog,
    project,
    setProject,
    sessions,
    setSessions,
    views,
    saveView: (name) => {
      const n = name.trim();
      if (!n) return;
      writeViews([...views.filter((v) => v.name !== n), { name: n, ids: placed ?? [] }]);
      setViewName(n);
    },
    deleteView: (name) => writeViews(views.filter((v) => v.name !== name)),
    viewName,
    applyView: (v) => {
      writePlaced(v.ids);
      setViewName(v.name);
    },
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
      views: [],
      saveView: () => {},
      deleteView: () => {},
      viewName: "Overview",
      applyView: () => {},
    }
  );
}

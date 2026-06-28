"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { MetricDef } from "@/lib/fleet";
import type { SavedView, GridBox } from "@/lib/fleet-views";

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

export type { SavedView };

// Four recommended starting boards, seeded into the save menu + the kpi-panel.
// Each is shaped for a BALANCED grid under the shelf-pack defaults (fleet-grid):
// a full 6-stat band FIRST (6 × w2 = one filled row), then an EVEN number of chart
// cards (each w6 = two per row → no half-empty rows). Session-scoped views render
// "pick one session" placeholders until a session is selected (lib/fleet na()) —
// still a full stat row + balanced chart rows, just empty until scoped.
export const RECOMMENDED_VIEWS: SavedView[] = [
  { name: "Overview", ids: ["f_sessions", "f_tokens", "f_turns", "f_projects", "todos_pending", "f_cliff", "tokens_day", "tokens_by_project", "sessions_by_context", "model_usage"] },
  { name: "Cost & burn", ids: ["f_spend", "f_tokens", "f_turns", "f_sessions", "f_projects", "f_cliff", "tokens_stacked_area", "tokens_day_area", "tokens_by_project", "sessions_by_context", "tokens_per_session", "model_usage"] },
  { name: "Session deep-dive", ids: ["s_turns", "s_user", "s_claude", "s_ctx_left", "s_total_time", "s_tok_per_turn", "context_burn", "tokens_by_turn", "time_per_turn", "tools_used", "turn_time_box", "ctx_burndown"] },
  { name: "Projects & trends", ids: ["f_projects", "f_sessions", "f_tokens", "f_turns", "todos_pending", "f_cliff", "tokens_by_project", "sessions_per_project", "tokens_sparklines", "sessions_calendar", "sessions_gantt", "sessions_timeline"] },
];

const Ctx = createContext<KpiCtx | null>(null);
const PLACED = "hq-fleet-placed";
const OPEN = "hq-kpis";
// per-view grid arrangement, keyed by view name — must match fleet-grid's storageKey
// (`hq-fleet-grid:<view>`). Saved views snapshot this so a dragged layout persists.
const GRID_PREFIX = "hq-fleet-grid:";

function readGridLayout(name: string): Record<string, GridBox> | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(GRID_PREFIX + name) || "null");
    return raw && typeof raw === "object" ? (raw as Record<string, GridBox>) : undefined;
  } catch {
    return undefined;
  }
}

function writeGridLayout(name: string, layout?: Record<string, GridBox>): void {
  try {
    if (layout && Object.keys(layout).length) localStorage.setItem(GRID_PREFIX + name, JSON.stringify(layout));
    else localStorage.removeItem(GRID_PREFIX + name);
  } catch {
    /* ignore */
  }
}

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
    } catch {
      /* no storage */
    }
    // Saved views now live on disk (~/.claude/hq/fleet-views.json) so they survive a
    // browser-storage wipe / device restart / different browser — load them.
    let live = true;
    fetch("/api/fleet/views", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        let loaded: SavedView[] = Array.isArray(d?.views) ? d.views : [];
        // one-time migration: lift any pre-disk localStorage views onto the sidecar
        // so an existing saved board isn't lost on the cutover (it has no layout yet —
        // re-save it once to capture the drag arrangement).
        if (loaded.length === 0) {
          try {
            const legacy = JSON.parse(localStorage.getItem("hq-fleet-views") || "null");
            if (Array.isArray(legacy) && legacy.length) {
              loaded = legacy;
              fetch("/api/fleet/views", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ views: legacy }),
              }).catch(() => {});
            }
          } catch {
            /* ignore */
          }
        }
        setViews(loaded);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Optimistic local update + persist the whole list to the disk sidecar (the client
  // owns ordering + dedupe). Fire-and-forget; a failed write just isn't durable.
  const writeViews = (v: SavedView[]) => {
    setViews(v);
    fetch("/api/fleet/views", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ views: v }),
    }).catch(() => {});
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
      // snapshot the CURRENT board's grid arrangement (the live drags — e.g. a card
      // pulled to full width) so the saved view restores exactly as it looks now.
      const layout = readGridLayout(viewName);
      const view: SavedView = { name: n, ids: placed ?? [], ...(layout ? { layout } : {}) };
      writeViews([...views.filter((v) => v.name !== n), view]);
      // carry the layout onto the new view's grid key so the rename doesn't drop it.
      writeGridLayout(n, layout);
      setViewName(n);
    },
    deleteView: (name) => {
      writeViews(views.filter((v) => v.name !== name));
      writeGridLayout(name, undefined); // drop its grid arrangement too
    },
    viewName,
    applyView: (v) => {
      // restore the saved arrangement BEFORE the grid reads it (it keys off the view
      // name); without this the grid would rebase to the balanced shelf-pack default.
      writeGridLayout(v.name, v.layout);
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

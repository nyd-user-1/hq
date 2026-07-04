"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/active state for the Metrics container (metrics-panel.tsx) — ONE push-in panel
// hosting Usage · Calls · Guardrails · Savings · Memory Audit · KPIs · API · Firehose,
// swapping between them in place. Mirrors console-state.tsx. Replaces the old
// terminal-nav-menu Metrics flyout.
export type MetricsKey =
  | "usage"
  | "calls"
  | "guardrails"
  | "savings"
  | "audit"
  | "kpi"
  | "api"
  | "firehose";

export const METRICS_PANELS: { key: MetricsKey; title: string; file: string }[] = [
  { key: "usage", title: "Usage", file: "usage-panel.tsx" },
  { key: "calls", title: "Calls", file: "calls-panel.tsx" },
  { key: "guardrails", title: "Guardrails", file: "guardrails-panel.tsx" },
  { key: "savings", title: "Savings", file: "savings-panel.tsx" },
  { key: "audit", title: "Memory Audit", file: "audit-panel.tsx" },
  { key: "kpi", title: "KPIs", file: "kpi-panel.tsx" },
  { key: "api", title: "API", file: "api-panel.tsx" },
  { key: "firehose", title: "Firehose", file: "firehose-panel.tsx" },
];

const KEYS = METRICS_PANELS.map((p) => p.key) as string[];
function isKey(v: string | null): v is MetricsKey {
  return !!v && KEYS.includes(v);
}

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  active: MetricsKey;
  setActive: (k: MetricsKey) => void;
  openAt: (k: MetricsKey) => void;
};

const MetricsContext = createContext<Ctx | null>(null);

export function MetricsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<MetricsKey>("usage");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-metrics") === "1");
      const a = localStorage.getItem("hq-metrics-active");
      if (isKey(a)) setActive(a);
    } catch {
      /* no storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-metrics", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem("hq-metrics-active", active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <MetricsContext.Provider
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
    </MetricsContext.Provider>
  );
}

export function useMetrics(): Ctx {
  return (
    useContext(MetricsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      active: "usage",
      setActive: () => {},
      openAt: () => {},
    }
  );
}

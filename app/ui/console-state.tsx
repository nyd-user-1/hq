"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/active state for the Console container (console-panel.tsx) — ONE push-in
// panel that hosts all eight console panels and swaps between them in place. The
// standalone panels still exist (each with its own state); this drives the unified
// surface. Both the open flag and the active panel persist to localStorage.

export type ConsoleKey =
  | "commands"
  | "skills"
  | "plugins"
  | "routines"
  | "hooks"
  | "mcp"
  | "agents"
  | "outputStyles";

// The switcher list (A–Z by title) + the file each panel's boundary chip shows when
// it's active. Order here IS the dropdown order; find-by-key everywhere else, so
// sorting is display-only.
export const CONSOLE_PANELS: { key: ConsoleKey; title: string; file: string }[] = [
  { key: "agents", title: "Agents", file: "agents-panel.tsx" },
  { key: "commands", title: "Commands", file: "commands-panel.tsx" },
  { key: "hooks", title: "Hooks", file: "hooks-panel.tsx" },
  { key: "mcp", title: "MCP", file: "mcp-panel.tsx" },
  { key: "outputStyles", title: "Output Styles", file: "output-styles-panel.tsx" },
  { key: "plugins", title: "Plugins", file: "plugins-panel.tsx" },
  { key: "routines", title: "Routines", file: "routines-panel.tsx" },
  { key: "skills", title: "Skills", file: "skills-panel.tsx" },
];

const KEYS = CONSOLE_PANELS.map((p) => p.key) as string[];
function isKey(v: string | null): v is ConsoleKey {
  return !!v && KEYS.includes(v);
}

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  active: ConsoleKey;
  setActive: (k: ConsoleKey) => void;
  openAt: (k: ConsoleKey) => void; // set active + open — the nav entry point
};

const ConsoleContext = createContext<Ctx | null>(null);

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ConsoleKey>("commands");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-console") === "1");
      const a = localStorage.getItem("hq-console-active");
      if (isKey(a)) setActive(a);
    } catch {
      /* no storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-console", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem("hq-console-active", active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <ConsoleContext.Provider
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
    </ConsoleContext.Provider>
  );
}

export function useConsole(): Ctx {
  return (
    useContext(ConsoleContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      active: "commands",
      setActive: () => {},
      openAt: () => {},
    }
  );
}

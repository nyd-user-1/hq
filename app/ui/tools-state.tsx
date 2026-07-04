"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/active state for the Tools container (tools-panel.tsx) — ONE push-in panel
// that hosts the Tools panels (Compose · Preview · Text · Tree) and swaps between
// them in place. Direct mirror of console-state.tsx / activity-state.tsx. Both the
// open flag and the active panel persist to localStorage.

export type ToolsKey = "compose" | "preview" | "text" | "tree";

// Order here IS the dropdown order. find-by-key everywhere else, so this stays
// display-only.
export const TOOLS_PANELS: { key: ToolsKey; title: string; file: string }[] = [
  { key: "compose", title: "Compose", file: "compose-panel.tsx" },
  { key: "preview", title: "Preview", file: "preview-panel.tsx" },
  { key: "text", title: "Text", file: "text-editor-panel.tsx" },
  { key: "tree", title: "Tree", file: "tree-panel.tsx" },
];

const KEYS = TOOLS_PANELS.map((p) => p.key) as string[];
function isKey(v: string | null): v is ToolsKey {
  return !!v && KEYS.includes(v);
}

type Ctx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  active: ToolsKey;
  setActive: (k: ToolsKey) => void;
  openAt: (k: ToolsKey) => void; // set active + open — the nav entry point
};

const ToolsContext = createContext<Ctx | null>(null);

export function ToolsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ToolsKey>("compose");

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-tools") === "1");
      const a = localStorage.getItem("hq-tools-active");
      if (isKey(a)) setActive(a);
    } catch {
      /* no storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-tools", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  useEffect(() => {
    try {
      localStorage.setItem("hq-tools-active", active);
    } catch {
      /* ignore */
    }
  }, [active]);

  return (
    <ToolsContext.Provider
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
    </ToolsContext.Provider>
  );
}

export function useTools(): Ctx {
  return (
    useContext(ToolsContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      active: "compose",
      setActive: () => {},
      openAt: () => {},
    }
  );
}

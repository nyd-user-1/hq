"use client";

import { createContext, useContext, useEffect, useState } from "react";

// Open/close state for the standalone MCP panel — a sibling of the Skills /
// Commands panels (its own #mcp-panel-root portal). Persisted to localStorage.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const McpContext = createContext<Ctx | null>(null);

export function McpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("hq-mcp") === "1");
    } catch {
      /* no storage — default closed */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("hq-mcp", open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);
  return (
    <McpContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </McpContext.Provider>
  );
}

export function useMcp(): Ctx {
  return (
    useContext(McpContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

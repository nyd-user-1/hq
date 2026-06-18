"use client";

import { createContext, useContext, useEffect, useState } from "react";

// The ⌘K command palette's open/close state + its GLOBAL hotkey. Mounted once at
// the shell root so ⌘/Ctrl+K toggles the palette from anywhere — the terminal,
// any panel, even while a textarea is focused (the modifier means it never
// interferes with typing). The palette UI lives in command-palette.tsx; this
// owns only the toggle. Not persisted — a refresh starts closed (like a launcher
// should). ⌘K is the web-app convention and, unlike ⌘T, is not a reserved
// browser-chrome shortcut, so preventDefault keeps it from leaking out.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const CommandContext = createContext<Ctx | null>(null);

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <CommandContext.Provider
      value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}
    >
      {children}
    </CommandContext.Provider>
  );
}

export function useCommand(): Ctx {
  return (
    useContext(CommandContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

"use client";

import { createContext, useContext, useState } from "react";

// Open/close state for the independent Preview panel — an in-app live view of a
// project's local dev server (iframe + reconnect lifecycle), so a dev-server
// restart never bounces you to Safari's dead page. Like the Plugins/API/Planner
// panels it lives in its OWN portal root (#preview-panel-root) driven by this
// client state, so it can sit open alongside Activity/Search/etc.
type Ctx = { open: boolean; setOpen: (v: boolean) => void; toggle: () => void };

const PreviewContext = createContext<Ctx | null>(null);

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  // Always start CLOSED — launching hq must never auto-pop the preview panel (it
  // would spin up a project dev server unbidden). The panel opens only on an
  // explicit toggle; the state lives for the session because this provider sits
  // at the root and never unmounts — we just don't persist it across launches.
  const [open, setOpen] = useState(false);
  return (
    <PreviewContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </PreviewContext.Provider>
  );
}

export function usePreview(): Ctx {
  return (
    useContext(PreviewContext) ?? {
      open: false,
      setOpen: () => {},
      toggle: () => {},
    }
  );
}

"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import ComponentsList from "@/app/ui/components-list";
import { useComponentsPanel } from "@/app/ui/components-panel-state";

// Standalone Components panel — the skills-panel push-in standard. The same
// ComponentsList the @panel/components route renders, but fed client-side from
// GET /api/components (ordered registry + each file's source + undiscovered). A
// fetch nonce re-keys the list so a reopen shows fresh data + order.
type ListProps = ComponentProps<typeof ComponentsList>;

export default function ComponentsPanel() {
  const { open, setOpen } = useComponentsPanel();
  const [data, setData] = useState<{ items: ListProps["items"]; undiscovered: ListProps["undiscovered"] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/components", { cache: "no-store" }).then((res) => res.json());
      setData({ items: r?.items ?? [], undiscovered: r?.undiscovered ?? [] });
      setNonce((n) => n + 1);
    } catch {
      setData({ items: [], undiscovered: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <AppPanel rootId="components-panel-root" open={open} onClose={() => setOpen(false)} widthClass="sm:w-[min(360px,40vw)]">
      <Boundary label="components-panel.tsx">
        {data ? (
          <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <ComponentsList key={nonce} items={data.items} undiscovered={data.undiscovered} />
          </div>
        ) : (
          <p className="font-mono text-[11px] text-zinc-600">{loading ? "loading…" : "no components"}</p>
        )}
      </Boundary>
    </AppPanel>
  );
}

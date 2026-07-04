"use client";

import { useRef, useState } from "react";
import BoundaryChip from "@/app/ui/boundary-chip";
import { TOOLS_PANELS, type ToolsKey } from "@/app/ui/tools-state";
import { useCompose } from "@/app/ui/compose-state";
import { usePreview } from "@/app/ui/preview-state";
import { useTextEditor } from "@/app/ui/text-editor-state";
import { useTree } from "@/app/ui/tree-state";

// lucide "arrow-up-right" — the "pop out" glyph on each menu row. Clicking it opens
// that panel as its OWN standalone push-in (independent of the container), so two
// tools panels can sit side by side.
function ArrowUpRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

// The Tools boundary's file-path chip — but wired to reveal the panel switcher.
// It IS the click-to-copy BoundaryChip (label = the active panel's file); HOVER over
// it drops the list of the four tools panels. A row's TEXT swaps the container in
// place (tools-panel re-keys its Boundary, so the flash replays + the chip label
// changes); the trailing "↗" instead pops that panel out as its own standalone
// panel. Mirrors console-switch-chip.tsx.
export default function ToolsSwitchChip({
  file,
  active,
  onSelect,
}: {
  file: string;
  active: ToolsKey;
  onSelect: (k: ToolsKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  // Each tools panel's standalone push-in state — the "↗" opens one independent of
  // the container (keyed by ToolsKey).
  const standalone: Record<ToolsKey, (v: boolean) => void> = {
    compose: useCompose().setOpen,
    preview: usePreview().setOpen,
    text: useTextEditor().setOpen,
    tree: useTree().setOpen,
  };
  const popOut = (k: ToolsKey) => {
    standalone[k](true);
    setOpen(false);
  };

  return (
    <div
      className="relative flex shrink-0 items-stretch self-stretch"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {/* the boundary file chip — click still copies the path (BoundaryChip default) */}
      <BoundaryChip label={file} />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-52 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          {TOOLS_PANELS.map((p) => (
            <div
              key={p.key}
              className="flex items-center rounded transition-colors hover:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(p.key);
                  setOpen(false);
                }}
                className={`flex flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-xs ${p.key === active ? "text-zinc-100" : "text-zinc-300"}`}
              >
                <span>{p.title}</span>
                {p.key === active && <span className="text-[8px] text-blue-400">●</span>}
              </button>
              <button
                type="button"
                onClick={() => popOut(p.key)}
                aria-label={`open ${p.title} in a separate panel`}
                title="open in a separate panel"
                className="mr-1 rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <ArrowUpRight />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

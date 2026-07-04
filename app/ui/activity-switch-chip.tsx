"use client";

import { useRef, useState } from "react";
import BoundaryChip from "@/app/ui/boundary-chip";
import { ACTIVITY_PANELS, type ActivityKey } from "@/app/ui/activity-state";
import { useProjectsPanel } from "@/app/ui/projects-panel-state";
import { useTodoPanel } from "@/app/ui/todo-panel-state";
import { useComponentsPanel } from "@/app/ui/components-panel-state";
import { useChangelog } from "@/app/ui/changelog-state";
import { useIssues } from "@/app/ui/issues-state";
import { useTasks } from "@/app/ui/tasks-state";
import { useRouter, useSearchParams } from "next/navigation";
import { withPins } from "@/app/ui/keep-pins";

// lucide "arrow-up-right" — the "pop out" glyph on each menu row. Clicking it opens
// that panel as its OWN standalone push-in (independent of the container), so e.g.
// Projects can sit in the Activity container while To Do rides beside it.
function ArrowUpRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

// The Activity boundary's file-path chip — but wired to reveal the panel switcher.
// It IS the click-to-copy BoundaryChip (label = the active panel's file); HOVER over
// it drops the list of Activity panels. A row's TEXT swaps the container in place
// (activity-panel re-keys its Boundary, so the flash replays + the chip label
// changes); the trailing "↗" instead pops that panel out as its own standalone panel.
export default function ActivitySwitchChip({
  file,
  active,
  onSelect,
}: {
  file: string;
  active: ActivityKey;
  onSelect: (k: ActivityKey) => void;
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

  // Each Activity panel's standalone push-in state — the "↗" opens one independent of
  // the container (keyed by ActivityKey).
  const standalone: Record<ActivityKey, (v: boolean) => void> = {
    projects: useProjectsPanel().setOpen,
    todos: useTodoPanel().setOpen,
    components: useComponentsPanel().setOpen,
    changelog: useChangelog().setOpen,
    issues: useIssues().setOpen,
    tasks: useTasks().setOpen,
  };
  const popOut = (k: ActivityKey) => {
    standalone[k](true);
    setOpen(false);
  };

  const router = useRouter();
  const params = useSearchParams();
  // Search isn't a container member — it's the /search route panel. Its row (and ↗)
  // just navigate there. Rows below are sorted A–Z by title.
  const openSearch = () => {
    router.push(withPins("/search", params.toString()), { scroll: false });
    setOpen(false);
  };
  const rows = [
    ...ACTIVITY_PANELS.map((p) => ({ key: p.key as string, title: p.title, search: false })),
    { key: "search", title: "Search", search: true },
  ].sort((a, b) => a.title.localeCompare(b.title));

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
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center rounded transition-colors hover:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => {
                  if (row.search) openSearch();
                  else {
                    onSelect(row.key as ActivityKey);
                    setOpen(false);
                  }
                }}
                className={`flex flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-xs ${row.key === active ? "text-zinc-100" : "text-zinc-300"}`}
              >
                <span>{row.title}</span>
                {row.key === active && <span className="text-[8px] text-blue-400">●</span>}
              </button>
              <button
                type="button"
                onClick={() => (row.search ? openSearch() : popOut(row.key as ActivityKey))}
                aria-label={`open ${row.title} in a separate panel`}
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

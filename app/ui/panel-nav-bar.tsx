"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NAV_HEADERS, type NavHeader, type ToggleKey } from "@/app/ui/panel-nav";
import { withPins } from "@/app/ui/keep-pins";
import { usePlanner } from "@/app/ui/planner-state";
import { useApi } from "@/app/ui/api-state";
import { useTextEditor } from "@/app/ui/text-editor-state";
import { usePlugins } from "@/app/ui/plugins-state";
import { usePreview } from "@/app/ui/preview-state";
import { useSkills } from "@/app/ui/skills-state";
import { useKpis } from "@/app/ui/kpi-state";
import { useCommands } from "@/app/ui/commands-state";
import { useHooks } from "@/app/ui/hooks-state";
import { useMcp } from "@/app/ui/mcp-state";
import { useAgents } from "@/app/ui/agents-state";
import { useOutputStyles } from "@/app/ui/output-styles-state";
import { usePermissions } from "@/app/ui/permissions-state";
import { useChangelog } from "@/app/ui/changelog-state";
import { useComponentsPanel } from "@/app/ui/components-panel-state";
import { useProjectsPanel } from "@/app/ui/projects-panel-state";
import { useTodoPanel } from "@/app/ui/todo-panel-state";

type Toggle = { open: boolean; toggle: () => void };

// The header nav bar — a horizontal row of dropdown headers (Activity · Console ·
// Metrics) styled like the send-box model picker. Each dropdown lists leaves that
// are EITHER pin-carrying route Links OR client-state toggle buttons (api / plugins
// / planner / text). Dropdowns open on hover, close on leave / select / outside
// click. A `cols` header lays its leaves out in a grid. Source: NAV_HEADERS.
export default function PanelNav() {
  // All four toggle contexts, resolved once and addressed by key — leaves name a
  // ToggleKey rather than importing hooks themselves.
  const toggles: Record<ToggleKey, Toggle> = {
    planner: usePlanner(),
    api: useApi(),
    text: useTextEditor(),
    plugins: usePlugins(),
    preview: usePreview(),
    skills: useSkills(),
    commands: useCommands(),
    hooks: useHooks(),
    mcp: useMcp(),
    agents: useAgents(),
    outputStyles: useOutputStyles(),
    permissions: usePermissions(),
    kpis: useKpis(),
    changelog: useChangelog(),
    componentsPanel: useComponentsPanel(),
    projectsPanel: useProjectsPanel(),
    todoPanel: useTodoPanel(),
  };
  return (
    <nav className="flex min-w-0 items-center gap-0.5">
      {NAV_HEADERS.map((h) => (
        <Dropdown key={h.title} header={h} toggles={toggles} />
      ))}
      <SearchNav />
    </nav>
  );
}

// Search is a single destination, not a group — so it sits in the nav row as a
// DIRECT item (not a dropdown), styled like the dropdown triggers, after Metrics.
// Replaces the old boundary "search" chip: toggles the /search panel (click while
// open → back to "/") and carries the terminal pins so it never drops a pair.
function SearchNav() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname() ?? "/";
  const active = pathname.startsWith("/search");
  return (
    <button
      type="button"
      title="Search every session and memory"
      onClick={() =>
        router.push(withPins(active ? "/" : "/search", params.toString()), {
          scroll: false,
        })
      }
      className={`${TRIGGER} ${active ? ACTIVE : IDLE}`}
    >
      Search
    </button>
  );
}

// Shared trigger look — the send-box model-picker button (bare, mono, hover bg).
const TRIGGER =
  "flex shrink-0 cursor-pointer list-none items-center rounded-md px-1.5 py-1 font-mono text-[11px] transition-colors marker:content-none [&::-webkit-details-marker]:hidden";
const IDLE = "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200";
const ACTIVE = "bg-zinc-800 text-zinc-100";

function Dropdown({
  header,
  toggles,
}: {
  header: NavHeader;
  toggles: Record<ToggleKey, Toggle>;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  // Native <details> doesn't close on an outside click — wire that up.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);
  // "Active" when the current route is one of the header's route leaves, or one
  // of its toggle leaves is open.
  const active = header.items.some((it) =>
    "href" in it ? it.href === pathname : "toggle" in it ? toggles[it.toggle].open : false,
  );
  const cols = header.cols ?? 1;
  return (
    <details
      ref={ref}
      className="relative shrink-0"
      // Navbar-style: open on hover, close when the pointer leaves.
      onMouseEnter={() => { if (ref.current) ref.current.open = true; }}
      onMouseLeave={() => { if (ref.current) ref.current.open = false; }}
    >
      <summary
        title={`${header.title} panels`}
        className={`${TRIGGER} ${active ? ACTIVE : IDLE}`}
      >
        {header.title}
      </summary>
      {/* pt-1.5 is a TRANSPARENT hover-bridge (a descendant of <details>) so the
          pointer can cross the gap from trigger to menu without firing mouseleave. */}
      <div className="absolute left-0 top-full z-30 pt-1.5">
        <div
          className={`whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-950 py-1 shadow-xl ${
            cols === 2 ? "grid w-80 grid-cols-2 gap-x-1 px-1" : "flex w-44 flex-col"
          }`}
        >
          {header.items.map((it) =>
            "soon" in it ? (
              <span
                key={it.title}
                title="Coming soon"
                className="cursor-default rounded px-3 py-1.5 font-mono text-[11px] text-zinc-700"
              >
                {it.title}
              </span>
            ) : "href" in it ? (
              <Link
                key={it.title}
                href={withPins(it.href, params.toString())}
                scroll={false}
                onClick={close}
                className={`rounded px-3 py-1.5 font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
                  it.href === pathname ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {it.title}
              </Link>
            ) : (
              <button
                key={it.title}
                type="button"
                onClick={() => {
                  toggles[it.toggle].toggle();
                  close();
                }}
                className={`rounded px-3 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
                  toggles[it.toggle].open ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {it.title}
              </button>
            ),
          )}
        </div>
      </div>
    </details>
  );
}

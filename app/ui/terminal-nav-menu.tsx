"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_HEADERS, type NavLeaf, type ToggleKey } from "@/app/ui/panel-nav";
import { withPins } from "@/app/ui/keep-pins";
import { usePlanner } from "@/app/ui/planner-state";
import { useApi } from "@/app/ui/api-state";
import { useTextEditor } from "@/app/ui/text-editor-state";
import { usePlugins } from "@/app/ui/plugins-state";
import { usePreview } from "@/app/ui/preview-state";
import { useSkills } from "@/app/ui/skills-state";
import { useCommands } from "@/app/ui/commands-state";
import { useHooks } from "@/app/ui/hooks-state";
import { useMcp } from "@/app/ui/mcp-state";
import { useAgents } from "@/app/ui/agents-state";
import { useOutputStyles } from "@/app/ui/output-styles-state";
import { usePermissions } from "@/app/ui/permissions-state";

type Toggle = { open: boolean; toggle: () => void };
type Leaf = NavLeaf | { title: string; href: string };

// The EXACT sidebar session-item menu (same font/layout/header/footer) with the
// content swapped: the four panel groups — Activity · Console · Search · Metrics —
// each opens its OWN second dropdown (flyout). Triggered by the message-turn ⋮
// kebab, placed after the session id in the terminal header.
const ROW = "flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900";
const IP = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ActivityIcon = () => (<svg {...IP}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>);
const ConfigIcon = () => (<svg {...IP}><line x1="21" y1="4" x2="14" y2="4" /><line x1="10" y1="4" x2="3" y2="4" /><line x1="21" y1="12" x2="12" y2="12" /><line x1="8" y1="12" x2="3" y2="12" /><line x1="21" y1="20" x2="16" y2="20" /><line x1="12" y1="20" x2="3" y2="20" /><line x1="14" y1="2" x2="14" y2="6" /><line x1="8" y1="10" x2="8" y2="14" /><line x1="16" y1="18" x2="16" y2="22" /></svg>);
const ConsoleIcon = () => (<svg {...IP}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>);
const SearchIcon = () => (<svg {...IP}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>);
const MetricsIcon = () => (<svg {...IP}><line x1="18" x2="18" y1="20" y2="10" /><line x1="12" x2="12" y1="20" y2="4" /><line x1="6" x2="6" y1="20" y2="14" /></svg>);
const Chevron = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><path d="m9 18 6-6-6-6" /></svg>);
const Branch = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>);

const SEARCH_SCOPES: Leaf[] = [
  { title: "All", href: "/search?scope=all" },
  { title: "Transcripts", href: "/search?scope=transcripts" },
  { title: "Memory", href: "/search?scope=memory" },
  { title: "Notes", href: "/search?scope=notes" },
  { title: "Files", href: "/search?scope=files" },
];
const ITEMS = [
  { key: "Activity", Icon: ActivityIcon },
  { key: "Config", Icon: ConfigIcon },
  { key: "Console", Icon: ConsoleIcon },
  { key: "Search", Icon: SearchIcon },
  { key: "Metrics", Icon: MetricsIcon },
];

export default function TerminalNavMenu({
  project,
  branch,
  sessionId,
}: {
  project: string;
  branch?: string;
  sessionId?: string | null;
}) {
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
  };
  const params = useSearchParams();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open on HOVER; a small grace on leave lets the pointer cross to the menu/flyout.
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setFlyout(null);
    }, 160);
  };
  const close = () => {
    setOpen(false);
    setFlyout(null);
  };
  const subItems = (key: string): Leaf[] =>
    key === "Search" ? SEARCH_SCOPES : (NAV_HEADERS.find((h) => h.title === key)?.items ?? []);
  const renderLeaf = (it: Leaf) =>
    "soon" in it ? (
      <span key={it.title} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-xs text-zinc-700">{it.title}</span>
    ) : "href" in it ? (
      <Link key={it.title} href={withPins(it.href, params.toString())} scroll={false} onClick={close} className={`${ROW} ${it.href === pathname ? "text-zinc-100" : ""}`}>
        {it.title}
      </Link>
    ) : (
      <button key={it.title} type="button" onClick={() => { toggles[it.toggle].toggle(); close(); }} className={`${ROW} w-full ${toggles[it.toggle].open ? "text-zinc-100" : ""}`}>
        {it.title}
      </button>
    );

  return (
    <div className="relative flex shrink-0 items-center" onMouseEnter={enter} onMouseLeave={leave}>
      {/* the message-turn ⋮ kebab — bare white dots at rest, muted grey rounded bg on hover */}
      <button
        type="button"
        title="panels"
        aria-label="panels menu"
        className={`rounded p-1 text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white ${open ? "bg-zinc-800" : ""}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex w-52 flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
          {/* read-only context — project + branch (matches the sidebar Recents menu) */}
          <div className="flex flex-col gap-0.5 px-2 pb-1.5 pt-1">
            <span className="min-w-0 truncate text-xs text-zinc-300">{project || "session"}</span>
            {branch && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500" title={`branch: ${branch}`}>
                <Branch />
                <span className="min-w-0 truncate">{branch}</span>
              </span>
            )}
          </div>
          <div className="my-1 h-px bg-zinc-800" />
          {ITEMS.map(({ key, Icon }) => (
            <div key={key} className="relative" onMouseEnter={() => setFlyout(key)}>
              <div className={`${ROW} justify-between ${flyout === key ? "bg-zinc-900 text-zinc-100" : ""}`}>
                <span className="flex items-center gap-2.5">
                  <Icon />
                  {key}
                </span>
                <Chevron />
              </div>
              {flyout === key && (
                <div className="absolute top-0 z-50 pl-1" style={{ left: "100%" }}>
                  <div className="flex flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
                    {subItems(key).map(renderLeaf)}
                  </div>
                </div>
              )}
            </div>
          ))}
          {sessionId && (
            <>
              <div className="my-1 h-px bg-zinc-800" />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(sessionId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
                title={`click to copy ${sessionId}`}
                className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left font-mono text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
              >
                <span className="min-w-0 truncate">{copied ? "copied ✓" : `${sessionId.slice(0, 8)}…`}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

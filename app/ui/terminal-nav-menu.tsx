"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV_HEADERS, type NavLeaf, type ToggleKey } from "@/app/ui/panel-nav";
import { withPins } from "@/app/ui/keep-pins";
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
import { useConsole } from "@/app/ui/console-state";
import { useActivity } from "@/app/ui/activity-state";
import { useTools } from "@/app/ui/tools-state";
import { usePermissions } from "@/app/ui/permissions-state";
import { useKpis } from "@/app/ui/kpi-state";
import { useChangelog } from "@/app/ui/changelog-state";
import { useComponentsPanel } from "@/app/ui/components-panel-state";
import { useProjectsPanel } from "@/app/ui/projects-panel-state";
import { useTodoPanel } from "@/app/ui/todo-panel-state";
import { useTeams } from "@/app/ui/teams-state";
import { useTasks } from "@/app/ui/tasks-state";
import { useIssues } from "@/app/ui/issues-state";
import { useTree } from "@/app/ui/tree-state";
import { useRoutines } from "@/app/ui/routines-state";
import { useFirehose } from "@/app/ui/firehose-state";
import { useUsage } from "@/app/ui/usage-state";
import { useCalls } from "@/app/ui/calls-state";
import { useGuardrails } from "@/app/ui/guardrails-state";
import { useSavings } from "@/app/ui/savings-state";
import { useAudit } from "@/app/ui/audit-state";
import { useCompose } from "@/app/ui/compose-state";
import { useSettings } from "@/app/ui/settings-state";
import { useEnvironment } from "@/app/ui/environment-state";
import { useTrustedFolders } from "@/app/ui/trusted-folders-state";

type Toggle = { open: boolean; toggle: () => void };
type Leaf = NavLeaf | { title: string; href: string };

// The EXACT sidebar session-item menu (same font/layout/header/footer) with the
// content swapped: the four panel groups — Activity · Console · Search · Metrics —
// each opens its OWN second dropdown (flyout). Triggered by the message-turn ⋮
// kebab, placed after the session id in the terminal header.
const ROW = "flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900";
const IP = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const ActivityIcon = () => (<svg {...IP}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>);
const ConsoleIcon = () => (<svg {...IP}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>);
const MetricsIcon = () => (<svg {...IP}><line x1="18" x2="18" y1="20" y2="10" /><line x1="12" x2="12" y1="20" y2="4" /><line x1="6" x2="6" y1="20" y2="14" /></svg>);
const Chevron = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600"><path d="m9 18 6-6-6-6" /></svg>);
const Branch = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>);
// lucide "wrench" — the Tools group glyph (Compose · Preview · Text · Tree).
const ToolsIcon = () => (<svg {...IP}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" /></svg>);

const ITEMS = [
  { key: "Activity", Icon: ActivityIcon },
  { key: "Console", Icon: ConsoleIcon },
  { key: "Metrics", Icon: MetricsIcon },
  { key: "Tools", Icon: ToolsIcon },
];

export default function TerminalNavMenu({
  project,
  name,
  branch,
  sessionId,
}: {
  project: string;
  // The session's display name (rename or short id) — shown as the menu's title
  // instead of the project. Falls back to the project, then "session".
  name?: string;
  branch?: string;
  sessionId?: string | null;
}) {
  const toggles: Record<ToggleKey, Toggle> = {
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
    teamsPanel: useTeams(),
    tasksPanel: useTasks(),
    issues: useIssues(),
    treePanel: useTree(),
    routinesPanel: useRoutines(),
    firehosePanel: useFirehose(),
    usagePanel: useUsage(),
    callsPanel: useCalls(),
    guardrailsPanel: useGuardrails(),
    savingsPanel: useSavings(),
    auditPanel: useAudit(),
    composePanel: useCompose(),
    settingsPanel: useSettings(),
    environmentPanel: useEnvironment(),
    trustedFoldersPanel: useTrustedFolders(),
  };
  const consoleCtx = useConsole();
  const activityCtx = useActivity();
  const toolsCtx = useTools();
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
    NAV_HEADERS.find((h) => h.title === key)?.items ?? [];
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
          <div className="flex flex-col gap-0.5 px-2 pb-1.5 pt-1" onMouseEnter={() => setFlyout(null)}>
            <span className="min-w-0 truncate text-xs text-zinc-300">{name || project || "session"}</span>
            {branch && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-500" title={`branch: ${branch}`}>
                <Branch />
                <span className="min-w-0 truncate">{branch}</span>
              </span>
            )}
          </div>
          <div className="my-1 h-px bg-zinc-800" />
          {ITEMS.map(({ key, Icon }) => {
            // Activity + Console open their drill-down container DIRECTLY (no flyout);
            // the container's own "⌄" switches panels. Metrics stays a flyout.
            const container = key === "Console" ? consoleCtx : key === "Activity" ? activityCtx : key === "Tools" ? toolsCtx : null;
            return container ? (
              <button
                key={key}
                type="button"
                onMouseEnter={() => setFlyout(null)}
                onClick={() => {
                  container.setOpen(true);
                  close();
                }}
                className={`${ROW} w-full ${container.open ? "bg-zinc-900 text-zinc-100" : ""}`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon />
                  {key}
                </span>
              </button>
            ) : (
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
            );
          })}
          {sessionId && (
            <>
              <div className="my-1 h-px bg-zinc-800" />
              <button
                type="button"
                onMouseEnter={() => setFlyout(null)}
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

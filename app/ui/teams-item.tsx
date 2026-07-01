"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { slotOf } from "@/app/ui/terminals";

// The sidebar "Agent Teams" section — the single entry to live teams. Click the
// header to reveal each team's LEAD session as a row (styled like a Recents row):
// a lucide NETWORK icon + the lead's short id; clicking it pins the lead in the
// center terminal, exactly like a Recents session. The row's ⋮ kebab is populated
// by the TEAMMATES (not the favorite/rename actions) — click a teammate to open
// its session in the terminal. (teams-panel.tsx still exists as the alternate
// surface, reachable via the ▾ menu's "Team".)
type Member = {
  name: string;
  agentId: string;
  agentType: string;
  color: string;
  isLead: boolean;
};
type Team = { id: string; leadSessionId: string; leadTranscriptId?: string; members: Member[] };

const COLOR_MAP: Record<string, string> = {
  blue: "text-blue-400",
  green: "text-green-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  magenta: "text-fuchsia-400",
  cyan: "text-cyan-400",
};

// lucide "network" — a hub with three connected nodes; marks a team session.
function NetworkIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}
function KebabIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

export default function TeamsItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const [teams, setTeams] = useState<Team[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/teams", { cache: "no-store" }).then((res) => res.json());
      setTeams(r?.teams ?? []);
    } catch {
      /* offline / no teams */
    }
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  // Close the kebab on any outside click / Escape / scroll (mirrors sidebar-recents).
  useEffect(() => {
    if (!menuFor) return;
    const close = () => {
      setMenuFor(null);
      setMenuPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuFor]);

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (menuFor === id) {
      setMenuFor(null);
      setMenuPos(null);
      return;
    }
    const row = ((e.currentTarget as HTMLElement).closest(".group") as HTMLElement) ?? (e.currentTarget as HTMLElement);
    const r = row.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8));
    setMenuPos({ top: r.bottom + 4, left, width: r.width });
    setMenuFor(id);
  };

  // Clicking a team row pins its LEAD in the center terminal (a plain ?session, like
  // a Recents row). Clicking a teammate opens that teammate's session (@tm: token).
  const leadHref = (lead: string) => `${pathname}?session=${lead}`;
  const teammateHref = (teamId: string, member: string) =>
    `${pathname}?session=${encodeURIComponent(`@tm:${teamId}:${member}`)}`;

  const menuTeam = menuFor ? teams.find((t) => t.id === menuFor) : null;
  const menuMates = menuTeam ? menuTeam.members.filter((m) => !m.isLead) : [];

  return (
    <div className="flex flex-col">
      {/* header — Agent Teams (toggle) */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        title="Agent Teams — live teams; click a team to pin its lead"
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        <NetworkIcon />
        Agent Teams
      </button>

      {/* team rows — each team's LEAD session, styled like a Recents row */}
      {expanded && teams.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
          {teams.map((t) => {
            const lead = t.leadTranscriptId || t.leadSessionId;
            const active = slotOf(params, lead) > 0;
            return (
              <div
                key={t.id}
                className={`group flex items-center rounded-md transition-colors ${
                  active || menuFor === t.id ? "bg-zinc-800" : "hover:bg-zinc-800/60"
                }`}
              >
                <Link
                  href={leadHref(lead)}
                  scroll={false}
                  className={`flex min-w-0 flex-1 items-center py-1.5 pl-2.5 text-sm transition-colors ${
                    active ? "text-zinc-100" : "text-zinc-400 group-hover:text-zinc-200"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{lead.slice(0, 8)}</span>
                </Link>
                <button
                  onClick={(e) => openMenu(e, t.id)}
                  title="teammates"
                  aria-label="teammates"
                  className={`shrink-0 px-1.5 py-1.5 text-zinc-500 transition-opacity hover:text-zinc-200 ${
                    menuFor === t.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <KebabIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* kebab dropdown — the TEAMMATES (fixed-position, like sidebar-recents) */}
      {menuTeam && menuPos && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.width }}
          className="fixed z-50 flex flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
        >
          <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            teammates
          </div>
          {menuMates.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-zinc-600">no teammates yet</div>
          ) : (
            menuMates.map((m) => (
              <Link
                key={m.agentId || m.name}
                href={teammateHref(menuTeam.id, m.name)}
                scroll={false}
                onClick={() => {
                  setMenuFor(null);
                  setMenuPos(null);
                }}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                <span className={`text-[10px] leading-none ${COLOR_MAP[m.color] ?? "text-zinc-400"}`} aria-hidden>
                  ●
                </span>
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.agentType && m.agentType !== "general-purpose" && (
                  <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wide text-zinc-500">
                    {m.agentType}
                  </span>
                )}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

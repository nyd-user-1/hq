"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTeams } from "@/app/ui/teams-state";
import { MAX_TERMINALS } from "@/app/ui/terminals";

// Teams sidebar item — the entry into the team WALL. Clicking it opens the newest
// live agent team across the terminal wall: Terminal 1 = the interactive lead
// (its real session), wall panes 2-4 = the teammates (read-only, fed from their
// subagent transcripts via the "@tm:<teamId>:<member>" token). When no team is
// live it just opens the Teams panel (which explains how to spawn one). It polls
// /api/teams so it lights up the moment a team forms.
type Member = { name: string; isLead: boolean };
type Team = { id: string; leadSessionId: string; leadTranscriptId?: string; members: Member[] };

export default function TeamsItem() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const { setOpen } = useTeams();
  const [teams, setTeams] = useState<Team[]>([]);

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

  const onClick = () => {
    const team = teams[0]; // /api/teams is newest-first
    // The lead's REAL transcript — the hq-spawned uuid for a tmux team, else
    // config.leadSessionId. This is what actually resolves + is drivable in T1.
    const lead = team?.leadTranscriptId || team?.leadSessionId;
    if (!team || !lead) {
      setOpen(true); // no live team → open the panel (empty-state guidance)
      return;
    }
    // Lead → Terminal 1; teammates → wall panes (capped). Replace session+wall.
    const teammates = team.members
      .filter((m) => !m.isLead)
      .slice(0, MAX_TERMINALS - 1)
      .map((m) => `@tm:${team.id}:${m.name}`);
    const sp = new URLSearchParams(params.toString());
    sp.set("session", lead);
    // The LEAD anchor: marks this wall as a team and locks slot 1 to the lead so
    // T1 never snaps back to the newest session, and the ★ rides the lead pane.
    sp.set("lead", lead);
    if (teammates.length) sp.set("wall", teammates.join(","));
    else {
      sp.delete("wall");
      sp.delete("lead"); // no teammates ⇒ no wall ⇒ nothing to anchor against
    }
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const count = teams.length;
  return (
    <button
      type="button"
      onClick={onClick}
      title={count ? "Open the live agent team across the wall" : "Agent teams — none live yet"}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
    >
      {/* lucide Users */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      Teams
      {count > 0 && (
        <span className="ml-auto shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-emerald-300">
          {count}
        </span>
      )}
    </button>
  );
}

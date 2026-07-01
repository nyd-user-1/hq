"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTeams } from "@/app/ui/teams-state";
import { MAX_TERMINALS } from "@/app/ui/terminals";

// Teams sidebar item — the SINGLE entry point to the Teams surface. Clicking it
// OPENS the teams-panel (the control surface: team cards + Tasks/Mailbox
// drill-downs) and, by default, fills the wall with the most recent team
// (Terminal 1 = the lead, panes 2-4 = the teammates). From the panel the user
// clicks any card to switch which team fills the wall. Polls /api/teams.
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
    setOpen(true); // the panel is the Teams control surface — always open it
    // Default: fill the wall with the most recent team (the user switches from the
    // panel by clicking a card). No live team → the panel shows the empty state.
    const team = teams[0]; // /api/teams is newest-first
    const lead = team?.leadTranscriptId || team?.leadSessionId;
    if (!team || !lead) return;
    // Lead → Terminal 1; teammates → wall panes (capped). ?lead anchors the lead.
    const teammates = team.members
      .filter((m) => !m.isLead)
      .slice(0, MAX_TERMINALS - 1)
      .map((m) => `@tm:${team.id}:${m.name}`);
    const sp = new URLSearchParams(params.toString());
    sp.set("session", lead);
    sp.set("lead", lead);
    if (teammates.length) sp.set("wall", teammates.join(","));
    else {
      sp.delete("wall");
      sp.delete("lead"); // no teammates ⇒ no wall ⇒ nothing to anchor against
    }
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title="Open the Teams panel"
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
    </button>
  );
}

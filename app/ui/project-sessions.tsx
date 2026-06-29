"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ago } from "@/lib/ago";
import type { RecentSession } from "@/lib/sessions";

// Matches the Skills row anatomy exactly: provenance dot · mono name (text-xs) ·
// description (text-xs, truncates) · mono right-meta. Reached by clicking a
// project card (?project=<name>); "← Projects" returns to the grid; clicking a
// row pins that session in the terminal (?session=<id>), panel + pins intact.
const ROW =
  "flex w-full items-baseline gap-3 border-b border-zinc-800/60 py-3 text-left transition-colors hover:bg-zinc-800/30";

export default function ProjectSessions({
  name,
  sessions,
  onBack,
  onPick,
}: {
  name: string;
  sessions: RecentSession[];
  // Standalone panel passes these to go back / pin in-panel (client state); the
  // @panel route omits them and keeps the URL <Link> nav.
  onBack?: () => void;
  onPick?: (id: string) => void;
}) {
  const params = useSearchParams();
  const current = params.get("session");

  const back = (() => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("project");
    const qs = sp.toString();
    return qs ? `/projects?${qs}` : "/projects";
  })();

  const pinHref = (id: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("session", id); // keep ?project + ?pair, pin this session
    return `/projects?${sp.toString()}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {/* header — mirrors the Skills detail header (← back · identifier · meta) */}
      <div className="flex items-baseline gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 font-mono text-xs text-blue-400 transition-colors hover:text-blue-300"
          >
            ← Projects
          </button>
        ) : (
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 transition-colors hover:text-blue-300"
          >
            ← Projects
          </Link>
        )}
        <span className="min-w-0 truncate font-mono text-xs text-zinc-300">
          {name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-zinc-600">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </span>
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-600">no sessions in this project</p>
      ) : (
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto">
          {sessions.map((s) => {
            const selected = current === s.id;
            const cls = `${ROW} ${selected ? "bg-green-500/[0.06]" : ""}`;
            const inner = (
              <>
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span
                    className={`text-[10px] leading-none ${
                      selected
                        ? "animate-pulse text-emerald-400 [text-shadow:0_0_6px_rgba(52,211,153,0.7)]"
                        : s.active
                          ? "text-green-500"
                          : "text-zinc-600"
                    }`}
                    aria-hidden
                  >
                    ●
                  </span>
                  <span className="font-mono text-xs text-zinc-200">
                    {s.customTitle || s.id.slice(0, 8)}
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                  {s.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-600">
                  {selected && <span className="text-green-400">in terminal · </span>}
                  {ago(s.lastActive)}
                  {s.branch ? ` · ${s.branch}` : ""}
                </span>
              </>
            );
            return onPick ? (
              <button key={s.id} type="button" onClick={() => onPick(s.id)} className={cls}>
                {inner}
              </button>
            ) : (
              <Link key={s.id} href={pinHref(s.id)} scroll={false} className={cls}>
                {inner}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

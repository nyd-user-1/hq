"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Claude-style "Recents": a live list of recent Claude Code sessions, newest
// first, labelled by the short session id (+ a dim project suffix) so each row
// lines up 1:1 with the id in the terminal header (first prompt → hover tooltip).
// Clicking one pins the center terminal to it (?session=<id>). A Group-by control
// (None/Date/Project) buckets the list — client-side; the payload carries
// lastActive + project.
type Recent = {
  id: string;
  project: string;
  title: string;
  lastActive: number;
  active: boolean;
};

type GroupBy = "none" | "date" | "project";
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "date", label: "Date" },
  { value: "project", label: "Project" },
];
const STORAGE_KEY = "hq:recents-group";

function dateBucket(ts: number, now: number): string {
  const d = new Date(now);
  const startOfToday = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  ).getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - 86_400_000) return "Yesterday";
  return "Previous 7 days";
}

// Buckets the (already newest-first) list per the chosen mode, preserving order.
function groupSessions(
  sessions: Recent[],
  mode: GroupBy
): { label: string; sessions: Recent[] }[] {
  if (mode === "none") return [{ label: "", sessions }];

  const map = new Map<string, Recent[]>();
  const keyOf = (s: Recent) =>
    mode === "project" ? s.project : dateBucket(s.lastActive, Date.now());
  for (const s of sessions) {
    const k = keyOf(s);
    const arr = map.get(k);
    if (arr) arr.push(s);
    else map.set(k, [s]);
  }

  if (mode === "date") {
    return ["Today", "Yesterday", "Previous 7 days"]
      .filter((l) => map.has(l))
      .map((label) => ({ label, sessions: map.get(label)! }));
  }
  // project — order groups by their most-recent session
  return [...map.entries()]
    .map(([label, ss]) => ({ label, sessions: ss }))
    .sort((a, b) => b.sessions[0].lastActive - a.sessions[0].lastActive);
}

// WIREFRAME: split-view glyph for the "open beside Terminal 1" affordance.
function SplitIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function Sliders({ active }: { active: boolean }) {
  return (
    <svg
      className={`size-3.5 transition-colors ${active ? "text-zinc-300" : "text-zinc-600"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="21" x2="14" y1="4" y2="4" />
      <line x1="10" x2="3" y1="4" y2="4" />
      <line x1="21" x2="12" y1="12" y2="12" />
      <line x1="8" x2="3" y1="12" y2="12" />
      <line x1="21" x2="16" y1="20" y2="20" />
      <line x1="12" x2="3" y1="20" y2="20" />
      <line x1="14" x2="14" y1="2" y2="6" />
      <line x1="8" x2="8" y1="10" y2="14" />
      <line x1="16" x2="16" y1="18" y2="22" />
    </svg>
  );
}

export default function SidebarRecents() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const current = params.get("session"); // terminal 1's session
  const pairParam = params.get("pair"); // terminal 2's session (if open)
  const [sessions, setSessions] = useState<Recent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const menuRef = useRef<HTMLDetailsElement>(null);

  // Restore the saved grouping (client-only → useEffect, no hydration mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "date" || saved === "project" || saved === "none")
      setGroupBy(saved);
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await (await fetch("/api/sessions")).json();
        if (alive) {
          setSessions(d.sessions ?? []);
          setLoaded(true);
        }
      } catch {
        // transient (dev recompile) — the interval picks it back up
      }
    };
    load();
    const t = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const choose = (v: GroupBy) => {
    setGroupBy(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // private mode / disabled storage — grouping just won't persist
    }
    if (menuRef.current) menuRef.current.open = false;
  };

  const groups = groupSessions(sessions, groupBy);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex items-center justify-between px-2.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          Recent Sessions
        </span>
        <details ref={menuRef} className="relative">
          <summary
            title="group sessions"
            className="flex cursor-pointer list-none items-center rounded p-0.5 text-zinc-600 transition-colors marker:content-none [&::-webkit-details-marker]:hidden hover:text-zinc-300"
          >
            <Sliders active={groupBy !== "none"} />
          </summary>
          <div className="absolute right-0 top-full z-20 mt-1 flex w-32 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl">
            <span className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              Group by
            </span>
            {GROUP_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => choose(o.value)}
                className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors hover:bg-zinc-900 ${
                  groupBy === o.value ? "text-zinc-100" : "text-zinc-400"
                }`}
              >
                {o.label}
                {groupBy === o.value && <span className="text-blue-400">✓</span>}
              </button>
            ))}
          </div>
        </details>
      </div>

      {loaded && !sessions.length ? (
        <p className="px-2.5 text-xs text-zinc-600">no recent sessions</p>
      ) : (
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label || "all"} className="flex flex-col gap-0.5">
              {g.label && (
                <span className="px-2.5 pb-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600/80">
                  {g.label}
                </span>
              )}
              {g.sessions.map((s) => {
                const active = current === s.id;
                // Open this session in Terminal 2, preserving Terminal 1 (?session).
                const pairHref = current
                  ? `${pathname}?session=${current}&pair=${s.id}`
                  : `${pathname}?pair=${s.id}`;
                // Open in Terminal 1, preserving Terminal 2 if it's already open.
                const openHref = pairParam
                  ? `${pathname}?session=${s.id}&pair=${pairParam}`
                  : `${pathname}?session=${s.id}`;
                return (
                  <div
                    key={s.id}
                    className={`group flex items-center rounded-md transition-colors ${
                      active ? "bg-zinc-800" : "hover:bg-zinc-800/60"
                    }`}
                  >
                    <Link
                      href={openHref}
                      scroll={false}
                      title={`${s.project} · ${s.title}`}
                      className={`flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-sm transition-colors ${
                        active
                          ? "text-zinc-100"
                          : "text-zinc-400 group-hover:text-zinc-200"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                        <span className="shrink-0 font-mono text-xs">
                          {s.id.slice(0, 8)}
                        </span>
                        <span className="min-w-0 truncate text-xs text-zinc-600">
                          {s.project}
                        </span>
                      </span>
                      {/* green = active within the cache window */}
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          s.active ? "bg-green-500" : "bg-transparent"
                        }`}
                      />
                    </Link>
                    {/* split affordance — appears on hover */}
                    <Link
                      href={pairHref}
                      scroll={false}
                      title="open beside Terminal 1"
                      aria-label="open beside Terminal 1"
                      className="shrink-0 px-2 py-1.5 text-zinc-600 opacity-0 transition hover:text-zinc-200 group-hover:opacity-100"
                    >
                      <SplitIcon />
                    </Link>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

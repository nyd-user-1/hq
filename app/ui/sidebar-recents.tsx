"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Claude-style "Recents": a live list of recent Claude Code sessions, newest
// first, labelled by the short session id (+ a dim project suffix, or a custom
// name once renamed) so each row lines up 1:1 with the id in the terminal header.
// Clicking one pins the center terminal to it (?session=<id>). Per-session view
// metadata — favorite (pins to top), hidden (soft-delete), and rename — lives in
// an HQ sidecar (~/.claude/hq/sessions-meta.json), never written into the
// transcripts. A Group-by control (None/Date/Project) buckets the list.
type Recent = {
  id: string;
  project: string;
  title: string;
  lastActive: number;
  active: boolean;
  branch: string;
  customTitle: string;
  favorite: boolean;
  hidden: boolean;
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
// In "none" mode, favorites float to the top (stable sort keeps mtime order
// within each tier); grouped modes keep their buckets and rely on the ★ marker.
function groupSessions(
  sessions: Recent[],
  mode: GroupBy
): { label: string; sessions: Recent[] }[] {
  if (mode === "none") {
    const sorted = [...sessions].sort(
      (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
    );
    return [{ label: "", sessions: sorted }];
  }

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

// split-view glyph for the "open beside Terminal 1" affordance.
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

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function PencilIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function EyeOffIcon() {
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
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function EyeIcon() {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg
      className="size-2.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
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
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // session id being renamed
  const [editValue, setEditValue] = useState("");
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

  // Optimistic local patch + fire-and-forget write to the sidecar. The 15s poll
  // reconciles with server truth.
  const patchLocal = (id: string, patch: Partial<Recent>) =>
    setSessions((xs) => xs.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const postMeta = (id: string, body: Record<string, unknown>) => {
    fetch("/api/sessions-meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    }).catch(() => {});
  };
  const toggleFavorite = (s: Recent) => {
    const favorite = !s.favorite;
    patchLocal(s.id, { favorite });
    postMeta(s.id, { favorite });
  };
  const toggleHidden = (s: Recent) => {
    const hidden = !s.hidden;
    patchLocal(s.id, { hidden });
    postMeta(s.id, { hidden });
  };
  const startEdit = (s: Recent) => {
    setEditing(s.id);
    setEditValue(s.customTitle);
  };
  const commitEdit = (s: Recent) => {
    const title = editValue.trim();
    patchLocal(s.id, { customTitle: title });
    postMeta(s.id, { title });
    setEditing(null);
  };

  const hiddenCount = sessions.filter((s) => s.hidden).length;
  const visible = showHidden ? sessions : sessions.filter((s) => !s.hidden);
  const groups = groupSessions(visible, groupBy);

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

                if (editing === s.id) {
                  return (
                    <div
                      key={s.id}
                      className="flex items-center rounded-md bg-zinc-800"
                    >
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(s);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={() => setEditing(null)}
                        placeholder="name this session — ↵ save · esc cancel"
                        className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={s.id}
                    className={`group flex items-center rounded-md transition-colors ${
                      active ? "bg-zinc-800" : "hover:bg-zinc-800/60"
                    } ${s.hidden ? "opacity-50" : ""}`}
                  >
                    <Link
                      href={openHref}
                      scroll={false}
                      title={`${s.project} · ${s.customTitle || s.title}`}
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
                        {s.customTitle ? (
                          <span className="min-w-0 truncate text-xs text-zinc-300">
                            {s.customTitle}
                          </span>
                        ) : (
                          <span className="min-w-0 truncate text-xs text-zinc-600">
                            {s.project}
                          </span>
                        )}
                      </span>
                      {s.branch && (
                        <span
                          className="flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-zinc-600"
                          title={`branch: ${s.branch}`}
                        >
                          <BranchIcon />
                          <span className="max-w-[5rem] truncate">{s.branch}</span>
                        </span>
                      )}
                      {/* green = active within the cache window */}
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          s.active ? "bg-green-500" : "bg-transparent"
                        }`}
                      />
                    </Link>
                    {/* favorite — stays lit when starred, else appears on hover */}
                    <button
                      onClick={() => toggleFavorite(s)}
                      title={s.favorite ? "unfavorite" : "favorite"}
                      aria-label={s.favorite ? "unfavorite" : "favorite"}
                      className={`shrink-0 px-1 py-1.5 transition ${
                        s.favorite
                          ? "text-amber-400 opacity-100"
                          : "text-zinc-600 opacity-0 hover:text-amber-400 group-hover:opacity-100"
                      }`}
                    >
                      <StarIcon filled={s.favorite} />
                    </button>
                    {/* rename — hover only */}
                    <button
                      onClick={() => startEdit(s)}
                      title="rename"
                      aria-label="rename session"
                      className="shrink-0 px-1 py-1.5 text-zinc-600 opacity-0 transition hover:text-zinc-200 group-hover:opacity-100"
                    >
                      <PencilIcon />
                    </button>
                    {/* hide / unhide — hover only */}
                    <button
                      onClick={() => toggleHidden(s)}
                      title={s.hidden ? "unhide" : "hide"}
                      aria-label={s.hidden ? "unhide session" : "hide session"}
                      className="shrink-0 px-1 py-1.5 text-zinc-600 opacity-0 transition hover:text-zinc-200 group-hover:opacity-100"
                    >
                      {s.hidden ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                    {/* split — open beside Terminal 1, hover only */}
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

          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="px-2.5 pt-1 text-left font-mono text-[10px] uppercase tracking-widest text-zinc-600 transition-colors hover:text-zinc-400"
            >
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

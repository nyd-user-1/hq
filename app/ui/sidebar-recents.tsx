"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Claude-style "Recents": a live list of recent Claude Code sessions, newest
// first, labelled by the short session id (+ a dim project suffix, or a custom
// name once renamed). Clicking a row pins the center terminal to it
// (?session=<id>). Per-row actions live behind a ⋮ kebab menu (Star / Rename /
// Set project / Related… / Terminal 2 / Hide) — like the Claude.ai chat row,
// NOT a cramped strip of inline icons. View metadata (favorite/hidden/rename/
// project override/related tags) lives in an HQ sidecar
// (~/.claude/hq/sessions-meta.json), never in the transcripts. A Group-by
// control (None/Date/Project) buckets the list; home-dir sessions with no
// project signal land in "Unassigned" until re-homed via Set project.
type Recent = {
  id: string;
  project: string;
  title: string;
  lastActive: number;
  active: boolean;
  branch: string;
  aiTitle: string;
  chainRoot: string;
  customTitle: string;
  favorite: boolean;
  hidden: boolean;
  related: string[];
};

type GroupBy = "none" | "date" | "project" | "tree";
const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "date", label: "Date" },
  { value: "project", label: "Project" },
  { value: "tree", label: "Tree" },
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
  // Older than yesterday → the calendar date, claude.ai-style ("Jun 19").
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  if (mode === "tree") {
    // Bucket by /clear chain. A multi-session chain gets the thread's current
    // title as a header (reuniting its fragments); a lone session stays
    // headerless (label "") so the list doesn't sprout a header per row.
    const byChain = new Map<string, Recent[]>();
    for (const s of sessions) {
      const k = s.chainRoot || s.id;
      const arr = byChain.get(k);
      if (arr) arr.push(s);
      else byChain.set(k, [s]);
    }
    return [...byChain.values()].map((ss) =>
      ss.length > 1
        ? {
            label: ss[0].customTitle || ss[0].aiTitle || ss[0].id.slice(0, 8),
            sessions: ss,
          }
        : { label: "", sessions: ss }
    );
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
    // Sessions arrive newest-first, so the Map's insertion order is already
    // Today → Yesterday → Jun 19 → Jun 18 … — just keep it.
    return [...map.entries()].map(([label, sessions]) => ({ label, sessions }));
  }
  // project — order groups by their most-recent session
  return [...map.entries()]
    .map(([label, ss]) => ({ label, sessions: ss }))
    .sort((a, b) => b.sessions[0].lastActive - a.sessions[0].lastActive);
}

function SplitIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function StarIcon({ filled, className = "size-3.5" }: { filled: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <line x1="10" y1="13" x2="14" y2="13" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg className="size-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
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

function Sliders({ active }: { active: boolean }) {
  return (
    <svg className={`size-3.5 transition-colors ${active ? "text-zinc-300" : "text-zinc-600"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("session"); // terminal 1's session
  const pairParam = params.get("pair"); // terminal 2's session (if open)
  const [sessions, setSessions] = useState<Recent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("date"); // default: grouped by day (claude.ai-style)
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // session id being edited inline
  const [editField, setEditField] = useState<"title" | "project" | "related">("title");
  const [editValue, setEditValue] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null); // row whose ⋮ menu is open
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [copiedId, setCopiedId] = useState(false); // ⋮-menu "copy id" feedback
  const menuRef = useRef<HTMLDetailsElement>(null);

  // Restore the saved grouping (client-only → useEffect, no hydration mismatch).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "date" || saved === "project" || saved === "none" || saved === "tree")
      setGroupBy(saved);
  }, []);

  useEffect(() => {
    let alive = true;
    const apply = (d: { sessions?: Recent[] }) => {
      if (alive && d?.sessions) {
        setSessions(d.sessions);
        setLoaded(true);
      }
    };
    const load = async () => {
      try {
        apply(await (await fetch("/api/sessions")).json());
      } catch {
        // transient (dev recompile) — the stream / focus reload picks it up
      }
    };
    load(); // fast first paint + fallback if the stream can't open

    // Live updates pushed by the fs.watch-backed SSE — replaces the 15s poll:
    // instant on real change, zero re-scans when idle.
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/sessions/stream");
      es.addEventListener("sessions", (e) => {
        try {
          apply(JSON.parse((e as MessageEvent).data));
        } catch {
          /* malformed frame — next push reconciles */
        }
      });
    } catch {
      // EventSource unavailable — the focus reload below is the fallback
    }
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      es?.close();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Close the kebab menu on any outside click, Escape, or scroll. (The menu
  // itself stops propagation; its items close it explicitly.)
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

  const choose = (v: GroupBy) => {
    setGroupBy(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // private mode / disabled storage — grouping just won't persist
    }
    if (menuRef.current) menuRef.current.open = false;
  };

  // Optimistic local patch + fire-and-forget write to the sidecar. The live SSE
  // stream reconciles with server truth on the next push.
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
  // One inline editor, three fields: the session title (rename), the project
  // override (re-home an Unassigned session), or the related cross-link tags.
  const startEdit = (s: Recent, field: "title" | "project" | "related") => {
    setEditField(field);
    setEditValue(
      field === "title"
        ? s.customTitle
        : field === "project"
          ? s.project
          : s.related.join(", ")
    );
    setEditing(s.id);
  };
  const commitEdit = (s: Recent) => {
    if (editField === "project") {
      const project = editValue.trim();
      if (project) patchLocal(s.id, { project }); // blank → poll re-derives
      postMeta(s.id, { project });
    } else if (editField === "related") {
      const related = [
        ...new Set(editValue.split(",").map((x) => x.trim()).filter(Boolean)),
      ];
      patchLocal(s.id, { related });
      postMeta(s.id, { related });
    } else {
      const title = editValue.trim();
      patchLocal(s.id, { customTitle: title });
      postMeta(s.id, { title });
    }
    setEditing(null);
  };

  const openMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCopiedId(false);
    // Toggle: clicking the ⋮ of the already-open row closes it. (stopPropagation
    // above means the window outside-click listener never fires for the kebab, so
    // the close has to happen here.)
    if (menuFor === id) {
      setMenuFor(null);
      setMenuPos(null);
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const row = (btn.closest(".group") as HTMLElement) ?? btn;
    const r = row.getBoundingClientRect();
    // Match the menu width to the session row so it drops straight down WITHIN
    // the sidebar — no right-edge cut-off, no item forced to two lines. (It's a
    // fixed overlay, so it's never clipped by the scroll container.)
    const w = r.width;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    setMenuPos({ top: r.bottom + 4, left, width: w });
    setMenuFor(id);
  };
  const closeMenu = () => {
    setMenuFor(null);
    setMenuPos(null);
  };

  const hiddenCount = sessions.filter((s) => s.hidden).length;
  const visible = showHidden ? sessions : sessions.filter((s) => !s.hidden);
  const groups = groupSessions(visible, groupBy);
  const menuSession = menuFor ? sessions.find((s) => s.id === menuFor) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex items-center justify-between px-2.5">
        {/* The first group's label sits here next to the group-by control —
            "Today" / "Recents" / a thread title — so there's no redundant
            standalone "Recent Sessions" line above it. */}
        <span className="font-mono text-[10px] tracking-widest text-zinc-500">
          {groups[0]?.label || "Recents"}
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
          {groups.map((g, gi) => (
            <div key={g.label || `g${gi}`} className="flex flex-col gap-0.5">
              {/* first group's label is shown up in the top bar; only render
                  in-list headers for groups after it */}
              {gi > 0 && g.label && (
                <span className="flex items-baseline gap-1.5 px-2.5 pb-0.5 pt-1 font-mono text-[10px] tracking-widest text-zinc-600/80">
                  {g.label}
                </span>
              )}
              {g.sessions.map((s) => {
                const active = current === s.id;
                const openHref = pairParam
                  ? `${pathname}?session=${s.id}&pair=${pairParam}`
                  : `${pathname}?session=${s.id}`;
                // Label precedence: your rename → Claude's ai-title → the id.
                const label = s.customTitle || s.aiTitle || s.id.slice(0, 8);
                const titled = !!(s.customTitle || s.aiTitle);

                if (editing === s.id) {
                  return (
                    <div key={s.id} className="flex items-center rounded-md bg-zinc-800">
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(s);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={() => setEditing(null)}
                        placeholder={
                          editField === "project"
                            ? "set project — ↵ save · esc cancel"
                            : editField === "related"
                              ? "related, comma-separated — ↵ save · esc cancel"
                              : "name this session — ↵ save · esc cancel"
                        }
                        className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={s.id}
                    className={`group flex items-center rounded-md transition-colors ${
                      active || menuFor === s.id ? "bg-zinc-800" : "hover:bg-zinc-800/60"
                    } ${s.hidden ? "opacity-50" : ""}`}
                  >
                    <Link
                      href={openHref}
                      scroll={false}
                      title={`${s.project} · ${s.customTitle || s.aiTitle || s.title} · ${s.id.slice(0, 8)}`}
                      className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 text-sm transition-colors ${
                        active
                          ? "text-zinc-100"
                          : "text-zinc-400 group-hover:text-zinc-200"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-x-1.5">
                        {/* label: rename → Claude's ai-title → id. Single line +
                            truncate (full name on hover, full id in the ⋮ menu) so
                            the row height never changes — IDs no longer wrap. */}
                        <span
                          className={`min-w-0 flex-1 truncate font-mono text-xs ${
                            titled ? "text-zinc-200" : ""
                          }`}
                        >
                          {label}
                        </span>
                        {s.related?.length > 0 && (
                          <span
                            title={`related: ${s.related.join(", ")}`}
                            className="shrink-0 rounded bg-zinc-800/70 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-zinc-500"
                          >
                            rel: {s.related.join(" · ")}
                          </span>
                        )}
                      </span>
                      {/* green = active within the cache window */}
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          s.active ? "bg-green-500" : "bg-transparent"
                        }`}
                      />
                    </Link>
                    {/* favorite indicator — subtle, persistent (toggle lives in the menu) */}
                    {s.favorite && (
                      <span className="shrink-0 pl-1 text-amber-400" title="favorite" aria-hidden>
                        <StarIcon filled className="size-3" />
                      </span>
                    )}
                    {/* the one row affordance: a kebab → dropdown menu */}
                    <button
                      onClick={(e) => openMenu(e, s.id)}
                      title="more actions"
                      aria-label="more actions"
                      className={`shrink-0 px-1.5 py-1.5 text-zinc-500 transition-opacity hover:text-zinc-200 ${
                        menuFor === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`}
                    >
                      <KebabIcon />
                    </button>
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

      {/* Kebab dropdown — fixed-positioned so the scroll container can't clip it.
          One menu at a time; opens from the clicked row's ⋮. */}
      {menuSession && menuPos && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          className="fixed z-50 flex flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
        >
          {/* read-only context — project + branch (moved out of the row) */}
          <div className="flex flex-col gap-0.5 px-2 pb-1.5 pt-1">
            <span className="min-w-0 truncate text-xs text-zinc-300">
              {menuSession.project || "Unassigned"}
            </span>
            {menuSession.branch && (
              <span
                className="flex items-center gap-1 font-mono text-[10px] text-zinc-500"
                title={`branch: ${menuSession.branch}`}
              >
                <BranchIcon />
                <span className="min-w-0 truncate">{menuSession.branch}</span>
              </span>
            )}
          </div>
          <div className="my-1 h-px bg-zinc-800" />
          <button
            role="menuitem"
            onClick={() => {
              toggleFavorite(menuSession);
              closeMenu();
            }}
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <StarIcon filled={menuSession.favorite} />
            {menuSession.favorite ? "Unstar" : "Star"}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              startEdit(menuSession, "title");
              closeMenu();
            }}
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <PencilIcon />
            Rename
          </button>
          <button
            role="menuitem"
            onClick={() => {
              startEdit(menuSession, "project");
              closeMenu();
            }}
            title="re-home this session under a project (overrides the derived label)"
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <ArchiveIcon />
            Set project
          </button>
          <button
            role="menuitem"
            onClick={() => {
              startEdit(menuSession, "related");
              closeMenu();
            }}
            title="tag other projects this session relates to (comma-separated)"
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <LinkIcon />
            Related…
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const pairHref = current
                ? `${pathname}?session=${current}&pair=${menuSession.id}`
                : `${pathname}?pair=${menuSession.id}`;
              router.push(pairHref, { scroll: false });
              closeMenu();
            }}
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <SplitIcon />
            Terminal 2
          </button>
          <button
            role="menuitem"
            onClick={() => {
              toggleHidden(menuSession);
              closeMenu();
            }}
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            {menuSession.hidden ? <EyeIcon /> : <EyeOffIcon />}
            {menuSession.hidden ? "Unhide" : "Hide"}
          </button>
          <div className="my-1 h-px bg-zinc-800" />
          <button
            role="menuitem"
            onClick={() => {
              navigator.clipboard.writeText(menuSession.id);
              setCopiedId(true);
              window.setTimeout(() => setCopiedId(false), 1200);
            }}
            title={`click to copy ${menuSession.id}`}
            className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left font-mono text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
          >
            {/* show the first segment; the click copies the FULL id */}
            <span className="min-w-0 truncate">
              {copiedId ? "copied ✓" : `${menuSession.id.slice(0, 8)}…`}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

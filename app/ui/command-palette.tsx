"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import Markdown from "@/app/ui/md";
import { withPins } from "@/app/ui/keep-pins";
import { NAV_TARGETS, type NavTarget } from "@/app/ui/panel-nav";
import { useCommand } from "@/app/ui/command-state";
import { usePlanner } from "@/app/ui/planner-state";
import { useTextEditor } from "@/app/ui/text-editor-state";
import { useSidebar } from "@/app/ui/sidebar-state";
import { KIND_TAG } from "@/app/ui/search-tags";
import { ago } from "@/lib/ago";

// The ⌘K command palette — a top-anchored launcher + universal search over a
// blurred backdrop. Three sections: ACTIONS (the client-state tools), NAVIGATE
// (every panel — labelled Group/Title, pin-carrying via withPins), and a live
// SEARCH section that debounce-queries /api/command-search (corpus-balanced, so
// Docs + every corpus surface). Clicking a search hit DRILLS IN: the palette
// becomes a reader for that item (skeleton → content from /api/search-content),
// with ← back to the results and ↗ open in panel for the in-panel reader. The
// result list lazy-loads (no cap) as you scroll. Hand-built — no cmdk/radix, per
// HQ's three-runtime-dep rule. State + the global hotkey live in command-state.tsx.

type Section = "Actions" | "Navigate" | "Search";

// Minimal client-side shape of a lib/search SearchHit (typed locally so we never
// import lib/search — it pulls node:fs into the bundle).
type Hit = {
  kind: string;
  ref: string;
  title: string;
  snippet: string;
  at: number;
  path?: string;
  meta?: string;
};

// Inline-viewer content from /api/search-content — the body we drop in when a
// result is drilled into (read it without leaving ⌘K).
type ViewerBody =
  | { format: "turns"; turns: { role: string; text: string }[]; note?: string }
  | { format: "markdown"; content: string }
  | { format: "code"; content: string };

type Command = {
  id: string;
  section: Section;
  title: string;
  hint?: string; // breadcrumb group (Navigate) — rendered as a "Group/" prefix
  kind?: string; // search-hit kind tag (Search)
  snippet?: string; // search-hit context line (Search)
  foot?: string; // search-hit identity — short session id or file path (Search)
  meta?: string; // search-hit descriptor — ext · project · repo · category (Search)
  at?: number; // search-hit last-touched ms (Search)
  hit?: Hit; // the raw hit (Search) — drives the drill-in viewer + open-in-panel
  keywords?: string;
  icon: React.ReactNode;
  run: () => void;
};

// Colored kind chip — the SAME accents the /search result badges use, so a
// transcript reads green, memory violet, note blue, commit orange, at a glance.
const kindTag = (k: string): string =>
  (KIND_TAG as Record<string, string>)[k] ?? "bg-zinc-800/60 text-zinc-300";

const STATIC_SECTIONS: Section[] = ["Actions", "Navigate"];

const SVG = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconSearch = () => (
  <svg {...SVG}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const IconText = () => (
  <svg {...SVG}>
    <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
    <path d="M9 20h6" />
    <path d="M12 4v16" />
  </svg>
);
const IconPlanner = () => (
  <svg {...SVG}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const IconSidebar = () => (
  <svg {...SVG}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </svg>
);
const IconClose = () => (
  <svg {...SVG}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
// per-group nav icons so the list isn't all identical glyphs
const IconActivity = () => (
  <svg {...SVG}>
    <path d="M12 2 2 7l10 5 10-5-10-5Z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </svg>
);
const IconMetrics = () => (
  <svg {...SVG}>
    <line x1="6" x2="6" y1="20" y2="14" />
    <line x1="12" x2="12" y1="20" y2="4" />
    <line x1="18" x2="18" y1="20" y2="10" />
  </svg>
);
const IconConsole = () => (
  <svg {...SVG}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" x2="20" y1="19" y2="19" />
  </svg>
);
const IconCompose = () => (
  <svg {...SVG}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
);
const IconDoc = () => (
  <svg {...SVG}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h6" />
  </svg>
);

function navIcon(t: NavTarget): React.ReactNode {
  if (t.href === "/compose") return <IconCompose />;
  if (t.group === "Activity") return <IconActivity />;
  if (t.group === "Metrics") return <IconMetrics />;
  if (t.group === "Console") return <IconConsole />;
  return <IconCompose />;
}

// substring/token ranking for the static commands — predictable, no fuzzy
// surprises. 0 = hidden. (Search hits bypass this — they're already query results.)
function rank(cmd: Command, q: string): number {
  if (!q) return 1;
  const hay = `${cmd.title} ${cmd.hint ?? ""} ${cmd.keywords ?? ""}`.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every((t) => hay.includes(t))) return 0;
  const title = cmd.title.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 80;
  if (title.includes(q)) return 60;
  if (title.split(/\s+/).some((w) => w.startsWith(tokens[0]))) return 50;
  return 30; // matched only via keywords / hint
}

// Map a hit kind → the /search panel's open-param, then build the deep-link
// (carrying the terminal pins by hand — withPins only takes a bare path).
function openHref(h: Hit, q: string): string {
  const e = encodeURIComponent;
  const op =
    h.kind === "transcript" || h.kind === "session" || h.kind === "sdk"
      ? `openSession=${h.ref}`
      : h.kind === "note"
        ? `openNote=${e(h.ref)}`
        : h.kind === "script"
          ? `openScript=${e(h.ref)}`
          : h.kind === "memory"
            ? `open=${e(h.ref)}`
            : h.kind === "file"
              ? `openFile=${e(h.ref)}`
              : h.kind === "component"
                ? `openComponent=${e(h.ref)}`
                : h.kind === "commit"
                  ? `openCommit=${e(h.ref)}`
                  : h.kind === "todo"
                    ? `openTodo=${e(h.ref)}`
                    : h.kind === "project"
                      ? `openProject=${e(h.ref)}`
                      : h.kind === "skill"
                        ? `openSkill=${e(h.ref)}`
                        : `openDoc=${e(h.ref)}`;
  const sp = new URLSearchParams(window.location.search);
  const pins = (["session", "pair"] as const)
    .map((k) => (sp.get(k) ? `${k}=${sp.get(k)}` : ""))
    .filter(Boolean)
    .join("&");
  return `/search?q=${e(q)}&scope=all&sort=new&${op}${pins ? `&${pins}` : ""}`;
}

// Loading shimmer for the drill-in viewer while content fetches.
function ViewerSkeleton() {
  const widths = [92, 68, 84, 74, 58, 80, 48];
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      {widths.map((w, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded bg-zinc-800"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

// The drilled-in result's body. Transcripts render as a chat; docs/memory/notes/
// todos/skills/projects as markdown; files/components/commits/scripts as code.
function ViewerBodyView({ body }: { body: ViewerBody | null }) {
  if (!body) return <ViewerSkeleton />;
  if (body.format === "turns")
    return (
      <div className="flex flex-col gap-3">
        {body.note && (
          <div className="font-mono text-[10px] uppercase tracking-wide text-amber-400">
            {body.note}
          </div>
        )}
        {body.turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span
              className={`font-mono text-[10px] uppercase tracking-wide ${
                t.role === "user"
                  ? "text-blue-400"
                  : t.role === "archived"
                    ? "text-amber-400"
                    : "text-emerald-400"
              }`}
            >
              {t.role === "user" ? "you" : t.role === "archived" ? "archived" : "claude"}
            </span>
            <div className="text-[12px] text-zinc-300">
              {t.role === "archived" ? (
                <div className="whitespace-pre-wrap break-words">{t.text}</div>
              ) : (
                <Markdown text={t.text} />
              )}
            </div>
          </div>
        ))}
      </div>
    );
  if (body.format === "code")
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
        {body.content}
      </pre>
    );
  return (
    <div className="text-[12px] text-zinc-300">
      <Markdown text={body.content} />
    </div>
  );
}

const PAGE = 25; // how many search results to reveal per lazy-load step

export default function CommandPalette() {
  const { open, setOpen } = useCommand();
  const router = useRouter();
  const { toggle: togglePlanner } = usePlanner();
  const { toggle: toggleText } = useTextEditor();
  const { toggle: toggleSidebar } = useSidebar();

  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const [shown, setShown] = useState(PAGE); // lazy-load window over the Search results
  const [viewing, setViewing] = useState<Hit | null>(null); // drilled-in result
  const [body, setBody] = useState<ViewerBody | null>(null); // its fetched content
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const go = useCallback(
    (href: string) =>
      router.push(withPins(href, window.location.search), { scroll: false }),
    [router]
  );

  // Debounced universal search as you type → /api/command-search (corpus-balanced,
  // so Docs + every corpus surface, not just the newest few). A big limit feeds the
  // lazy-loaded list; we reveal PAGE at a time client-side.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      setShown(PAGE);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/command-search?q=${encodeURIComponent(query)}&limit=200`
        );
        const data = await res.json();
        if (alive) {
          setHits(Array.isArray(data?.hits) ? data.hits : []);
          setShown(PAGE);
        }
      } catch {
        if (alive) setHits([]);
      }
    }, 160);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // Fetch the drilled-in result's body (skeleton while it loads).
  useEffect(() => {
    if (!viewing) {
      setBody(null);
      return;
    }
    let alive = true;
    setBody(null);
    fetch(
      `/api/search-content?kind=${encodeURIComponent(viewing.kind)}&ref=${encodeURIComponent(viewing.ref)}`
    )
      .then((r) => r.json())
      .then((d) => {
        if (alive) setBody(d);
      })
      .catch(() => {
        if (alive) setBody({ format: "markdown", content: "_failed to load_" });
      });
    return () => {
      alive = false;
    };
  }, [viewing]);

  const commands: Command[] = useMemo(
    () => [
      { id: "text", section: "Actions", title: "New text note", keywords: "text editor capture paste write", icon: <IconText />, run: toggleText },
      { id: "planner", section: "Actions", title: "Batch Planner", keywords: "planner batch burn cost sessions", icon: <IconPlanner />, run: togglePlanner },
      { id: "sidebar", section: "Actions", title: "Toggle sidebar", keywords: "sidebar recents hide show", icon: <IconSidebar />, run: toggleSidebar },
      { id: "home", section: "Actions", title: "Close panel", keywords: "close home terminal dismiss", icon: <IconClose />, run: () => go("/") },
      ...NAV_TARGETS.map((t) => ({
        id: `nav:${t.href}`,
        section: "Navigate" as const,
        title: t.title,
        hint: t.group || undefined,
        keywords: t.keywords,
        icon: navIcon(t),
        run: () => go(t.href),
      })),
    ],
    [go, togglePlanner, toggleText, toggleSidebar]
  );

  // A search hit's command. Clicking/Enter DRILLS IN (toggles the inline viewer)
  // rather than navigating — the ↗ control opens it in the panel instead.
  const searchCommands: Command[] = useMemo(
    () =>
      hits.map((h) => ({
        id: `hit:${h.kind}:${h.ref}`,
        section: "Search" as const,
        title: h.title || h.ref,
        kind: h.kind,
        snippet: h.snippet,
        // transcripts/sessions show the short session id; everything else its path
        foot:
          h.kind === "transcript" || h.kind === "session" || h.kind === "sdk"
            ? h.ref.slice(0, 8)
            : h.path ?? h.ref,
        meta: h.meta,
        at: h.at,
        hit: h,
        icon: <IconDoc />,
        run: () =>
          setViewing((cur) =>
            cur && cur.kind === h.kind && cur.ref === h.ref ? null : h
          ),
      })),
    [hits]
  );

  // Filter + rank the static commands, keep section order, then append the live
  // Search group (already query results — not re-ranked), sliced to the lazy-load
  // window. flat = selection order over what's actually rendered.
  const { groups, flat, total } = useMemo(() => {
    const query = q.trim().toLowerCase();
    const scored = commands
      .map((c) => ({ c, s: rank(c, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const grouped: { section: Section; items: Command[] }[] = STATIC_SECTIONS.map(
      (section) => ({
        section,
        items: scored.filter((x) => x.c.section === section).map((x) => x.c),
      })
    ).filter((g) => g.items.length > 0);
    if (searchCommands.length)
      grouped.push({ section: "Search", items: searchCommands.slice(0, shown) });
    const flatList: Command[] = [];
    grouped.forEach((g) => g.items.forEach((c) => flatList.push(c)));
    return { groups: grouped, flat: flatList, total: searchCommands.length };
  }, [commands, searchCommands, q, shown]);

  const selIdx = Math.min(sel, Math.max(0, flat.length - 1));

  // Reset + focus on open.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setHits([]);
    setShown(PAGE);
    setViewing(null);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the selected row in view as it moves.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${selIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selIdx]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // While drilled in, Esc steps back to the results (and refocuses the input)
  // instead of closing the palette.
  useEffect(() => {
    if (!open || !viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setViewing(null);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, viewing]);

  const backToResults = useCallback(() => {
    setViewing(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const openInPanel = useCallback(
    (h: Hit) => {
      setOpen(false);
      router.push(openHref(h, q), { scroll: false });
    },
    [setOpen, router, q]
  );

  const execute = useCallback(
    (cmd?: Command) => {
      if (!cmd) return;
      if (cmd.section === "Search") {
        cmd.run(); // drill in — keep the palette open
        return;
      }
      setOpen(false); // close the launcher first, then act
      cmd.run();
    },
    [setOpen]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Tab") {
      e.preventDefault();
      const dir = e.shiftKey ? flat.length - 1 : 1;
      setSel((s) => (flat.length ? (s + dir) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(flat[selIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Lazy-load: reveal another page as the list nears the bottom.
  function onListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (
      shown < total &&
      el.scrollHeight - el.scrollTop - el.clientHeight < 160
    ) {
      setShown((s) => Math.min(s + PAGE, total));
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{ animation: "cmdk-backdrop-in 130ms ease-out" }}
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 px-4 pt-[11vh] backdrop-blur-[2px]"
    >
      <div
        style={{ animation: "cmdk-pop-in 170ms cubic-bezier(0.16, 1, 0.3, 1)" }}
        className="relative flex max-h-[72vh] w-[720px] max-w-[94vw] flex-col rounded-xl bg-zinc-950 shadow-2xl ring-1 ring-zinc-800/60"
      >
        <Boundary label="command-palette.tsx">
          {viewing ? (
            // ── drill-in viewer: the palette IS the reader ──────────────────
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex items-center gap-3 border-b border-dashed border-zinc-800 pb-3">
                <button
                  onClick={backToResults}
                  className="flex shrink-0 items-center font-mono text-xs text-blue-400 hover:text-blue-300"
                >
                  ← back
                </button>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-200">
                  {viewing.title || viewing.ref}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${kindTag(viewing.kind)}`}
                >
                  {viewing.kind}
                </span>
                <button
                  onClick={() => openInPanel(viewing)}
                  className="shrink-0 font-mono text-[10px] text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  ↗ open in panel
                </button>
              </div>
              <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto pr-1">
                <ViewerBodyView body={body} />
              </div>
            </div>
          ) : (
            // ── launcher + search results ───────────────────────────────────
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {/* search row */}
              <div className="flex items-center gap-3 border-b border-dashed border-zinc-800 pb-3">
                <span className="text-zinc-500">
                  <IconSearch />
                </span>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setSel(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Type a command, or search everything…"
                  spellCheck={false}
                  className="w-full bg-transparent font-mono text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                />
                <kbd className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                  esc
                </kbd>
              </div>

              {/* results */}
              <div
                ref={listRef}
                onScroll={onListScroll}
                className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-2"
              >
                {flat.length === 0 ? (
                  <p className="px-1 py-10 text-center font-mono text-[12px] text-zinc-600">
                    {q.trim() ? `No results for “${q.trim()}”` : "No commands"}
                  </p>
                ) : (
                  groups.map((g, gi) => (
                    <Fragment key={g.section}>
                      {gi > 0 && (
                        <div className="mx-1 border-t border-dashed border-zinc-800/80" />
                      )}
                      <div className="flex flex-col gap-0.5">
                        <div className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                          {g.section}
                        </div>
                        {g.items.map((cmd) => {
                          const idx = flat.indexOf(cmd);
                          const isSel = idx === selIdx;
                          const isHit = cmd.section === "Search";
                          return (
                            <button
                              key={cmd.id}
                              data-idx={idx}
                              onMouseMove={() => setSel(idx)}
                              onClick={() => execute(cmd)}
                              className={`flex gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                                isHit ? "items-start" : "items-center"
                              } ${
                                isSel
                                  ? "bg-zinc-800 text-zinc-100"
                                  : "text-zinc-300 hover:bg-zinc-900"
                              }`}
                            >
                              <span
                                className={`shrink-0 ${isHit ? "mt-0.5" : ""} ${
                                  isSel ? "text-orange-400" : "text-zinc-500"
                                }`}
                              >
                                {cmd.icon}
                              </span>
                              {isHit ? (
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span className="truncate font-mono text-[13px]">
                                    {cmd.title}
                                  </span>
                                  {cmd.snippet && (
                                    <span className="truncate font-mono text-[11px] text-zinc-500">
                                      {cmd.snippet}
                                    </span>
                                  )}
                                  <span className="truncate font-mono text-[10px] text-zinc-600">
                                    {[cmd.foot, cmd.meta, cmd.at ? ago(cmd.at) : null]
                                      .filter(Boolean)
                                      .join("  ·  ")}
                                  </span>
                                </span>
                              ) : (
                                <span className="flex-1 truncate font-mono text-[13px]">
                                  {cmd.hint && (
                                    <span className="text-zinc-500">{cmd.hint}/</span>
                                  )}
                                  {cmd.title}
                                </span>
                              )}
                              {isHit && cmd.kind && (
                                <span
                                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${kindTag(
                                    cmd.kind
                                  )}`}
                                >
                                  {cmd.kind}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </Fragment>
                  ))
                )}
                {shown < total && (
                  <div className="px-1 py-2 text-center font-mono text-[10px] text-zinc-600">
                    scroll for more · {shown} of {total}
                  </div>
                )}
              </div>

              {/* footer */}
              <div className="flex items-center justify-between border-t border-dashed border-zinc-800 pt-2.5 font-mono text-[10px] text-zinc-600">
                <span>
                  {total > 0
                    ? `${total} result${total === 1 ? "" : "s"}`
                    : `${flat.length} result${flat.length === 1 ? "" : "s"}`}
                </span>
                <span>↑↓ navigate · ↵ open · esc close</span>
              </div>
            </div>
          )}
        </Boundary>
      </div>
    </div>,
    document.body
  );
}

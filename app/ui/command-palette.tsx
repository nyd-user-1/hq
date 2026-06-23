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

// The icon mirror of kindTag: just the `text-…` accent, so a result's leading
// glyph reads in its corpus color (todo amber, memory violet, commit orange)
// instead of one uniform tint — matching the kind badge on the right.
const kindIconColor = (k: string): string =>
  kindTag(k)
    .split(" ")
    .find((c) => c.startsWith("text-")) ?? "text-zinc-500";

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
// Per-kind result glyphs — so a memory note, a commit, a todo, a script, etc.
// each read at a glance instead of every row sharing the one doc icon. Lucide
// paths, same SVG base as the nav icons above.
const IconBrain = () => (
  <svg {...SVG}>
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
    <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
    <path d="M6 18a4 4 0 0 1-1.967-.516" />
    <path d="M19.967 17.484A4 4 0 0 1 18 18" />
  </svg>
);
const IconListTodo = () => (
  <svg {...SVG}>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="m3 17 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </svg>
);
const IconCommitVertical = () => (
  <svg {...SVG}>
    <path d="M12 3v6" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 15v6" />
  </svg>
);
const IconNotebookPen = () => (
  <svg {...SVG}>
    <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
    <path d="M2 6h4" />
    <path d="M2 10h4" />
    <path d="M2 14h4" />
    <path d="M2 18h4" />
    <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
  </svg>
);
const IconFileCode = () => (
  <svg {...SVG}>
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="m10 13-2 2 2 2" />
    <path d="m14 13 2 2-2 2" />
  </svg>
);
const IconFile = () => (
  <svg {...SVG}>
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
  </svg>
);
const IconBox = () => (
  <svg {...SVG}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </svg>
);
const IconMessage = () => (
  <svg {...SVG}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const IconFolder = () => (
  <svg {...SVG}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </svg>
);
const IconSparkles = () => (
  <svg {...SVG}>
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </svg>
);
// A hit's kind → its glyph. Anything unmapped falls back to the doc icon.
function hitIcon(kind: string): React.ReactNode {
  switch (kind) {
    case "memory":
      return <IconBrain />;
    case "todo":
      return <IconListTodo />;
    case "commit":
      return <IconCommitVertical />;
    case "note":
      return <IconNotebookPen />;
    case "script":
      return <IconFileCode />;
    case "file":
      return <IconFile />;
    case "component":
      return <IconBox />;
    case "transcript":
    case "session":
    case "sdk":
      return <IconMessage />;
    case "project":
      return <IconFolder />;
    case "skill":
      return <IconSparkles />;
    default:
      return <IconDoc />;
  }
}

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
// The drilled-in body as plain text, for the header copy-contents button.
function viewerText(body: ViewerBody | null): string {
  if (!body) return "";
  if (body.format === "turns")
    return body.turns.map((t) => `${t.role}: ${t.text}`).join("\n\n");
  return body.content;
}

// Copy the open file/note/transcript's contents — an icon button in the body's
// top-right cluster, flashing a check on copy. Icon-only so it pairs with the
// open-in-panel icon beside it.
function ViewerCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      aria-label="Copy contents"
      title="Copy contents"
      className={`flex shrink-0 items-center rounded p-0.5 transition-colors hover:text-zinc-200 ${
        copied ? "text-emerald-400" : "text-zinc-500"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </>
        )}
      </svg>
    </button>
  );
}

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

// ⌘K scope filter (Option C): a chip row + a typed "/alias " prefix both narrow
// the search to one corpus. Chips are the common corpora; the alias map also
// accepts the rarer ones as prefixes. "all" = no filter.
const SCOPE_CHIPS: { scope: string; label: string }[] = [
  { scope: "all", label: "All" },
  { scope: "files", label: "Files" },
  { scope: "sessions", label: "Sessions" },
  { scope: "memory", label: "Memory" },
  { scope: "notes", label: "Notes" },
  { scope: "commits", label: "Commits" },
  { scope: "todos", label: "Todos" },
  { scope: "docs", label: "Docs" },
];
const SCOPE_ALIASES: Record<string, string> = {
  file: "files", files: "files",
  session: "sessions", sessions: "sessions",
  memory: "memory", mem: "memory",
  note: "notes", notes: "notes",
  commit: "commits", commits: "commits",
  todo: "todos", todos: "todos",
  doc: "docs", docs: "docs",
  transcript: "transcripts", transcripts: "transcripts",
  component: "components", components: "components",
  project: "projects", projects: "projects",
  skill: "skills", skills: "skills",
  script: "scripts", scripts: "scripts",
  sdk: "sdk",
};

export default function CommandPalette() {
  const { open, setOpen } = useCommand();
  const router = useRouter();
  const { toggle: togglePlanner } = usePlanner();
  const { toggle: toggleText, openEdit } = useTextEditor();
  const [editNonce, setEditNonce] = useState(0); // bumped on hq:file-edited → re-fetch the open file
  const { toggle: toggleSidebar } = useSidebar();

  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all"); // ⌘K corpus filter (chip or /prefix)
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
    // Empty query: "all" is the launcher (no feed); a scope chip browses that
    // whole corpus newest-first (the API returns recent() for an empty q+scope).
    if (!query && scope === "all") {
      setHits([]);
      setShown(PAGE);
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/command-search?q=${encodeURIComponent(query)}&scope=${scope}&limit=200`,
          { signal: ctrl.signal }
        );
        const data = await res.json();
        if (alive) {
          setHits(Array.isArray(data?.hits) ? data.hits : []);
          setShown(PAGE);
        }
      } catch {
        if (alive) setHits([]); // ignore aborts (alive is already false then)
      }
      // Typed search debounces 90ms (server is fast: memoized docs, cached
      // commits, FTS5); a chip-click browse (empty q) fires at once.
    }, query ? 90 : 0);
    return () => {
      alive = false;
      ctrl.abort(); // cancel the in-flight request so fast typing can't pile up
      clearTimeout(t);
    };
  }, [q, scope]);

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
  }, [viewing, editNonce]);

  // When the Edit modal writes the open file back, re-fetch its body so the reader
  // reflects the save without leaving ⌘K.
  useEffect(() => {
    const onEdited = (e: Event) => {
      const d = (e as CustomEvent).detail as { kind: string; ref: string };
      if (viewing && viewing.kind === d.kind && viewing.ref === d.ref)
        setEditNonce((n) => n + 1);
    };
    window.addEventListener("hq:file-edited", onEdited);
    return () => window.removeEventListener("hq:file-edited", onEdited);
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
        icon: hitIcon(h.kind),
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
    const grouped: { section: Section; items: Command[] }[] = [];
    // A scope chip turns ⌘K into a corpus browser — suppress the launcher
    // (Actions/Navigate) so the chosen corpus fills the list. "all" keeps them.
    if (scope === "all") {
      const scored = commands
        .map((c) => ({ c, s: rank(c, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      STATIC_SECTIONS.forEach((section) => {
        const items = scored
          .filter((x) => x.c.section === section)
          .map((x) => x.c);
        if (items.length) grouped.push({ section, items });
      });
    }
    if (searchCommands.length)
      grouped.push({ section: "Search", items: searchCommands.slice(0, shown) });
    const flatList: Command[] = [];
    grouped.forEach((g) => g.items.forEach((c) => flatList.push(c)));
    return { groups: grouped, flat: flatList, total: searchCommands.length };
  }, [commands, searchCommands, q, shown, scope]);

  const selIdx = Math.min(sel, Math.max(0, flat.length - 1));

  // Reset + focus on open.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setScope("all");
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

  // Editable kinds for the reader's pencil: memory notes, HQ notes, repo .md.
  const canEdit = (h: Hit | null) =>
    !!h &&
    (h.kind === "memory" ||
      h.kind === "note" ||
      (h.kind === "file" && h.ref.endsWith(".md")));

  // Pencil → fetch the RAW file (frontmatter and all) and open it in the Text
  // editor in edit mode. The editor floats over the palette; on save it fires
  // hq:file-edited, which re-fetches the body here.
  const openEditor = useCallback(async () => {
    if (!viewing) return;
    try {
      const res = await fetch(
        `/api/file-edit?kind=${encodeURIComponent(viewing.kind)}&ref=${encodeURIComponent(viewing.ref)}`
      );
      if (!res.ok) return;
      const d = await res.json();
      openEdit({
        kind: viewing.kind,
        ref: viewing.ref,
        title: viewing.title || viewing.ref,
        content: typeof d?.content === "string" ? d.content : "",
      });
    } catch {
      /* leave the reader as-is on a fetch error */
    }
  }, [viewing, openEdit]);

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
              </div>
              <div className="relative min-h-0 flex-1">
                {/* Copy + open-in-panel float top-right of the BODY (over the
                    content), pinned as it scrolls. Both lucide icons so they pair. */}
                <div className="absolute right-2 top-1 z-10 flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950/90 px-1.5 py-1">
                  {canEdit(viewing) && (
                    <>
                      <button
                        onClick={openEditor}
                        aria-label="Edit file"
                        title="Edit file"
                        className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                      >
                        {/* lucide pencil */}
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                          <path d="m15 5 4 4" />
                        </svg>
                      </button>
                      <span className="h-3.5 w-px bg-zinc-800" />
                    </>
                  )}
                  <ViewerCopyButton text={viewerText(body)} />
                  <span className="h-3.5 w-px bg-zinc-800" />
                  <button
                    onClick={() => openInPanel(viewing)}
                    aria-label="Open in panel"
                    title="Open in panel"
                    className="flex shrink-0 items-center rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    {/* lucide square-arrow-out-up-right */}
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
                      <path d="m21 3-9 9" />
                      <path d="M15 3h6v6" />
                    </svg>
                  </button>
                </div>
                <div className="scrollbar-none h-full overflow-y-auto pr-1">
                  <ViewerBodyView body={body} />
                </div>
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
                    const v = e.target.value;
                    // "/file foo" (a recognized alias + space) flips the scope
                    // chip and strips the prefix — type-to-filter, Slack-style.
                    const m = v.match(/^\/([a-z]+)\s([\s\S]*)$/i);
                    const sc = m && SCOPE_ALIASES[m[1].toLowerCase()];
                    if (sc) {
                      setScope(sc);
                      setQ(m![2]);
                    } else {
                      setQ(v);
                    }
                    setSel(0);
                  }}
                  onKeyDown={(e) => {
                    // Backspace on an empty query clears an active scope chip.
                    if (e.key === "Backspace" && !q && scope !== "all") {
                      e.preventDefault();
                      setScope("all");
                      return;
                    }
                    onKeyDown(e);
                  }}
                  placeholder={
                    scope === "all"
                      ? "Type a command, or search everything…"
                      : `Search ${scope}…`
                  }
                  spellCheck={false}
                  className="w-full bg-transparent font-mono text-[14px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                />
                <kbd className="shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">
                  esc
                </kbd>
              </div>

              {/* scope filter — a thin chip row to narrow to one corpus (same as
                  a "/file " etc. typed prefix). Sits under the input, before the
                  results, and flex-wraps. */}
              <div className="flex flex-wrap items-center gap-1">
                {SCOPE_CHIPS.map((s) => (
                  <button
                    key={s.scope}
                    onClick={() => {
                      setScope(s.scope);
                      setSel(0);
                      inputRef.current?.focus();
                    }}
                    className={`rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                      scope === s.scope
                        ? "bg-blue-500/20 text-blue-300"
                        : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
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
                          {g.section === "Search" && scope !== "all"
                            ? SCOPE_CHIPS.find((c) => c.scope === scope)?.label ??
                              g.section
                            : g.section}
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
                                  isHit
                                    ? kindIconColor(cmd.kind ?? "")
                                    : isSel
                                      ? "text-orange-400"
                                      : "text-zinc-500"
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

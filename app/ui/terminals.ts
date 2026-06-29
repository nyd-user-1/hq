// The terminal wall's content assignments, read from the URL — one source of
// truth shared by the sidebar (Recents active state), the session search menu
// (slot badge + open-as-terminal), the boundary-chip menu, and terminal-row.
//   Terminal 1    = ?session=<id>            (the anchor — a session)
//   Terminals 2-4 = ?wall=<tok>,<tok>,<tok>  (comma-separated, capped at 3 extra)
// A wall TOKEN is typed: a bare session id ("1dd793d2…") OR a view ("@fleet").
// So a wall pane can hold a live session OR a dashboard view (the additive,
// non-co-equal model: T1 is the route, the wall is a modifier riding on top).
export const MAX_TERMINALS = 4;

// The views a terminal can host besides a session. "sessions" = the home index
// (projects + recent-sessions picker); the rest mirror the center overlays.
export type WallView = "sessions" | "fleet" | "files" | "projects";
export const WALL_VIEWS: readonly WallView[] = ["sessions", "fleet", "files", "projects"];

export type PaneContent =
  | { kind: "session"; sessionId: string }
  | { kind: "view"; view: WallView };

// "@fleet" → a view token; anything else → a session id. View tokens lead with
// "@" (no session id ever does), so the two never collide.
export function parseToken(tok: string): PaneContent | null {
  const t = tok.trim();
  if (!t) return null;
  if (t.startsWith("@")) {
    const v = t.slice(1) as WallView;
    return WALL_VIEWS.includes(v) ? { kind: "view", view: v } : null;
  }
  return { kind: "session", sessionId: t };
}

export function tokenFor(content: PaneContent): string {
  return content.kind === "view" ? `@${content.view}` : content.sessionId;
}

// The RAW wall tokens (sessions + views), in order — the source of truth for
// rebuilding ?wall. Capped at MAX_TERMINALS-1 extra panes.
export function wallTokens(params: URLSearchParams): string[] {
  return (params.get("wall") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMINALS - 1);
}

// The parsed wall panes (drops any malformed token).
export function wallPanes(params: URLSearchParams): PaneContent[] {
  return wallTokens(params)
    .map(parseToken)
    .filter((p): p is PaneContent => p !== null);
}

// Just the SESSION ids on the wall (view panes excluded) — for "which terminal is
// this session open in" matching.
export function wallIds(params: URLSearchParams): string[] {
  return wallPanes(params)
    .filter((p): p is { kind: "session"; sessionId: string } => p.kind === "session")
    .map((p) => p.sessionId);
}

// Ordered terminal slots → content (slot is 1-based). Terminal 1 is the ?session
// anchor (skipped while staging a new/home view, which has no concrete session).
export function getTerminals(params: URLSearchParams): { slot: number; content: PaneContent }[] {
  const out: { slot: number; content: PaneContent }[] = [];
  const t1 = params.get("session");
  if (t1 && t1 !== "new") out.push({ slot: 1, content: { kind: "session", sessionId: t1 } });
  wallPanes(params).forEach((c, i) => out.push({ slot: 2 + i, content: c }));
  return out;
}

// Which terminal slot (1-based) a SESSION occupies, or 0 if it isn't open.
export function slotOf(params: URLSearchParams, sessionId: string | null): number {
  if (!sessionId) return 0;
  return (
    getTerminals(params).find(
      (t) => t.content.kind === "session" && t.content.sessionId === sessionId,
    )?.slot ?? 0
  );
}

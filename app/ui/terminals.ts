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
  | { kind: "view"; view: WallView }
  // An agent-team TEAMMATE: an in-process subagent with no top-level session, so
  // it can't be a `session` pane. Read-only, fed from its subagent transcript.
  // Token form: "@tm:<teamId>:<member>" (e.g. "@tm:session-51fc766f:scout").
  | { kind: "teammate"; teamId: string; member: string };

// "@tm:…" → a teammate token; "@fleet" → a view token; anything else → a session
// id. Tokens leading with "@" never collide with a session id.
export function parseToken(tok: string): PaneContent | null {
  const t = tok.trim();
  if (!t) return null;
  if (t.startsWith("@tm:")) {
    const rest = t.slice(4);
    const i = rest.indexOf(":");
    if (i <= 0 || i >= rest.length - 1) return null;
    return { kind: "teammate", teamId: rest.slice(0, i), member: rest.slice(i + 1) };
  }
  if (t.startsWith("@")) {
    const v = t.slice(1) as WallView;
    return WALL_VIEWS.includes(v) ? { kind: "view", view: v } : null;
  }
  return { kind: "session", sessionId: t };
}

export function tokenFor(content: PaneContent): string {
  if (content.kind === "view") return `@${content.view}`;
  if (content.kind === "teammate") return `@tm:${content.teamId}:${content.member}`;
  return content.sessionId;
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

// Move the pane at `fromSlot` to `toSlot` (both 1-based) and return the new params:
// slot 1 → ?session (the anchor), the rest → ?wall. Dropping a pane onto slot 1
// PROMOTES it (its token becomes ?session). Slot 1 may be "home" (no real session)
// — a null placeholder keeps the slots lined up; you can't drag the home pane, but
// you can drop onto it (promoting the dragged pane and replacing home).
export function reorderPanes(
  params: URLSearchParams,
  fromSlot: number,
  toSlot: number,
): URLSearchParams {
  const same = () => new URLSearchParams(params.toString());
  const t1 = params.get("session");
  const t1Real = t1 && t1 !== "new" ? t1 : null;
  const bySlot: (string | null)[] = [t1Real, ...wallTokens(params)];
  // TEAM MODE: slot 1 is the LEAD, a locked anchor. Refuse any move that touches
  // it — no pane may be promoted INTO slot 1 (which would strand a teammate "@tm:"
  // token in the full Terminal, where it can't resolve → onboarding screen) and
  // the lead may not be dragged OUT. The lead stays put; teammates reorder freely.
  const lead = params.get("lead");
  if (
    fromSlot < 1 || fromSlot > bySlot.length ||
    toSlot < 1 || toSlot > bySlot.length ||
    fromSlot === toSlot ||
    bySlot[fromSlot - 1] == null || // can't move the home pane
    (lead && (fromSlot === 1 || toSlot === 1)) // can't disturb the locked lead
  ) {
    return same();
  }
  const next = [...bySlot];
  const [moved] = next.splice(fromSlot - 1, 1);
  next.splice(toSlot - 1, 0, moved);
  const sp = same();
  const head = next[0];
  if (head) sp.set("session", head);
  else sp.delete("session"); // null head ⇒ slot 1 is home again
  const rest = next.slice(1).filter((t): t is string => t != null);
  if (rest.length) sp.set("wall", rest.join(","));
  else sp.delete("wall");
  return sp;
}

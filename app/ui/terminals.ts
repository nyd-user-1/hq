// The terminal wall's session assignments, read from the URL — one source of
// truth shared by the sidebar (Recents active state), the session search menu
// (slot badge + open-as-terminal), and the kebab "Terminal N" action.
//   Terminal 1   = ?session=<id>
//   Terminals 2-4 = ?wall=<id2,id3,id4>  (comma-separated, capped at 3 extra panes)
export const MAX_TERMINALS = 4;

export function wallIds(params: URLSearchParams): string[] {
  return (params.get("wall") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMINALS - 1);
}

// Ordered terminal slots → session id (slot is 1-based).
export function getTerminals(params: URLSearchParams): { slot: number; sessionId: string }[] {
  const out: { slot: number; sessionId: string }[] = [];
  const t1 = params.get("session");
  if (t1) out.push({ slot: 1, sessionId: t1 });
  wallIds(params).forEach((id, i) => out.push({ slot: 2 + i, sessionId: id }));
  return out;
}

// Which terminal slot (1-based) a session occupies, or 0 if it isn't open.
export function slotOf(params: URLSearchParams, sessionId: string | null): number {
  if (!sessionId) return 0;
  return getTerminals(params).find((t) => t.sessionId === sessionId)?.slot ?? 0;
}

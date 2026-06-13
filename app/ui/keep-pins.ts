// Carry the terminal "pins" — ?session (Terminal 1) and ?pair (Terminal 2) —
// onto a route, so opening or closing a panel never drops them (which would
// reset Terminal 1 to newest and close Terminal 2). `search` is a
// location.search-style string (e.g. "?session=…&pair=…").
export function withPins(base: string, search: string): string {
  const cur = new URLSearchParams(search);
  const sp = new URLSearchParams();
  for (const k of ["session", "pair"] as const) {
    const v = cur.get(k);
    if (v) sp.set(k, v);
  }
  const q = sp.toString();
  return q ? `${base}?${q}` : base;
}

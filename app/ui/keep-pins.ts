// Carry the terminal "pins" — ?session (Terminal 1) and ?wall (the wall panes
// 2–4) — onto a route, so opening or closing a panel never drops them (which
// would reset Terminal 1 to newest and close the wall). `search` is a
// location.search-style string (e.g. "?session=…&wall=…").
export function withPins(base: string, search: string): string {
  const cur = new URLSearchParams(search);
  const sp = new URLSearchParams();
  for (const k of ["session", "wall"] as const) {
    const v = cur.get(k);
    if (v) sp.set(k, v);
  }
  const q = sp.toString();
  return q ? `${base}?${q}` : base;
}

// Pure string helpers shared by the search layers (lib/search.ts) and the
// all-time transcript index (lib/archive.ts). No node:fs — leaf module, so
// search → archive → text-search imports stay acyclic.

// Total occurrences across all tokens; 0 unless EVERY token appears. `lower`
// must already be lowercased; `toks` are lowercased query tokens.
export function scoreText(lower: string, toks: string[]): number {
  let total = 0;
  for (const t of toks) {
    let n = 0;
    for (let i = lower.indexOf(t); i !== -1; i = lower.indexOf(t, i + t.length))
      n++;
    if (n === 0) return 0;
    total += n;
  }
  return total;
}

// ~160 chars of context around the first hit of `tok`, on the ORIGINAL-case
// text so the snippet reads naturally. Match is case-insensitive.
export function snippetAround(text: string, tok: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const i = tok ? flat.toLowerCase().indexOf(tok) : -1;
  if (i === -1) return flat.slice(0, 160);
  const start = Math.max(0, i - 60);
  const end = Math.min(flat.length, i + tok.length + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${
    end < flat.length ? "…" : ""
  }`;
}

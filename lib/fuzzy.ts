// Tiny typo-tolerance helper — bounded Levenshtein + a token matcher, pure and
// dependency-free (HQ's three-runtime-dep rule). Used by the ⌘K palette's search
// to recover misspellings ("comand" → command-palette) that the exact
// substring/token pass in lib/search misses. Scoped to short metadata titles
// (session/component/todo/… names), so it stays cheap — a few thousand short
// strings per keystroke. Big-corpus fuzzy (transcripts/docs) is the Phase-2
// trigram-index job, not this.

// Levenshtein edit distance, bounded: returns the true distance, or `max + 1` as
// soon as a whole row provably exceeds the budget (early bailout keeps it cheap).
export function editDistance(a: string, b: string, max: number): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // entire row past budget → bail
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

// Typo-tolerant match of pre-tokenized query terms against a title. EVERY query
// token must match some word in the title within an edit-distance budget that
// scales with the token's length (short tokens demand exactness so they don't
// match everything). A substring is a free exact match (budget 0). Returns the
// total edit distance (lower = closer; 0 = a clean substring match) or null if
// any token finds no near-word.
export function fuzzyMatch(queryTokens: string[], title: string): number | null {
  // Split on non-alphanumerics AND camelCase boundaries, so a PascalCase name
  // ("CommandPalette") becomes ["command", "palette"] — otherwise it's one long
  // word that edit-distance can't reach from a short typo'd token.
  const words = title
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!words.length || !queryTokens.length) return null;
  let total = 0;
  for (const tok of queryTokens) {
    // ≤3 chars: exact only (fuzzy on tiny tokens is noise). 4–5: 1 edit. 6+: 2.
    const budget = tok.length <= 3 ? 0 : tok.length <= 5 ? 1 : 2;
    let best = Infinity;
    for (const w of words) {
      if (w.includes(tok)) {
        best = 0;
        break;
      }
      if (budget > 0) {
        const d = editDistance(tok, w, budget);
        if (d <= budget && d < best) best = d;
      }
    }
    if (best === Infinity) return null; // this token matched nothing → no hit
    total += best;
  }
  return total;
}

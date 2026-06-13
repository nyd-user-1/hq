// Pure string helpers shared by the search layers (lib/search.ts) and the
// all-time transcript index (lib/archive.ts). No node:fs — leaf module, so
// search → archive → text-search imports stay acyclic.

// Lowercase + collapse every run of non-alphanumerics to a single space. This
// is what makes phrase search punctuation-tolerant: a query like "wow..you did
// it." and the stored text "oh wow.. you did it." normalize to the SAME shape
// ("wow you did it"), so the phrase matches. Derived once per doc at load time
// (never per-search) so matching stays cheap.
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type Match = { score: number; phrase: boolean };

// Match already-NORMALIZED text against normalized query tokens. Returns BOTH a
// score and whether it was a contiguous-phrase hit — because phrase is a hard
// TIER, not a weight: the search layer keeps only phrase hits whenever any
// exist, and falls back to AND-of-tokens (every token present, any position)
// only when the phrase appears nowhere. Tiering this way (vs. a big numeric
// bonus) is what stops a long transcript full of common words like "it"/"you"
// from outranking a real phrase match. `score` is occurrence count within the
// tier: phrase hits → phrase occurrences; term hits → total token occurrences.
// 0 unless the phrase OR every token is present. The phrase is tokens joined by
// a single space, which equals normalize(query) by construction.
export function scoreNorm(norm: string, tokens: string[]): Match {
  if (tokens.length === 0) return { score: 0, phrase: false };

  const phrase = tokens.join(" ");
  let phraseHits = 0;
  for (let i = norm.indexOf(phrase); i !== -1; i = norm.indexOf(phrase, i + phrase.length))
    phraseHits++;

  // per-token occurrences; bail the moment a token is absent (AND semantics)
  let termHits = 0;
  for (const t of tokens) {
    let n = 0;
    for (let i = norm.indexOf(t); i !== -1; i = norm.indexOf(t, i + t.length)) n++;
    if (n === 0) return { score: 0, phrase: false };
    termHits += n;
  }

  return phraseHits > 0
    ? { score: phraseHits, phrase: true }
    : { score: termHits, phrase: false };
}

// ~160 chars of context around the first hit of `tok`, on the ORIGINAL-case
// text so the snippet reads naturally. Match is case-insensitive. `tok` is a
// normalized (alphanumeric) token, so it appears verbatim in the source text.
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

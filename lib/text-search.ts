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

// Occurrence score over already-NORMALIZED text. A contiguous phrase (all tokens
// in order) dominates; AND-of-tokens (every token present, any position) is the
// graceful fallback so a near-miss still surfaces below exact phrases. Returns 0
// unless the phrase OR every token is present. `tokens` are normalized query
// tokens (lowercase, alphanumeric); the phrase is their single-spaced join,
// which equals normalize(query) by construction.
export function scoreNorm(norm: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;

  // contiguous phrase occurrences
  const phrase = tokens.join(" ");
  let phraseHits = 0;
  for (let i = norm.indexOf(phrase); i !== -1; i = norm.indexOf(phrase, i + phrase.length))
    phraseHits++;

  // per-token occurrences; bail to 0 the moment a token is absent (AND semantics)
  let termHits = 0;
  for (const t of tokens) {
    let n = 0;
    for (let i = norm.indexOf(t); i !== -1; i = norm.indexOf(t, i + t.length)) n++;
    if (n === 0) return 0;
    termHits += n;
  }

  // phrase present → rank far above scattered-term matches; else AND-of-tokens
  return phraseHits > 0 ? phraseHits * 1000 + termHits : termHits;
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

// TEXT-QUOTE ANCHORING over a DOM subtree — the W3C Web Annotation
// TextQuoteSelector idea: describe a selection as {exact, prefix, suffix} and
// find it again later — across re-renders, and across inline-element boundaries
// (bold / code / links split one phrase into many text nodes, so a single-node
// search can't see it). Whitespace-insensitive: any run of whitespace equals a
// single space on both sides. Pure DOM, no React.

export type TextQuote = { exact: string; prefix: string; suffix: string };

const CONTEXT = 40; // chars of prefix/suffix kept — enough to disambiguate repeats

type Seg = { node: Text; start: number }; // start = this node's offset in the raw concatenation

const isWs = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === " " || c === "\f" || c === "\v";

// Collapse whitespace runs to one space; map[i] = raw index of norm[i].
function normalize(raw: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let ws = true; // drop leading whitespace
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (isWs(c)) {
      if (!ws) { norm += " "; map.push(i); }
      ws = true;
    } else {
      norm += c; map.push(i); ws = false;
    }
  }
  if (norm.endsWith(" ")) { norm = norm.slice(0, -1); map.pop(); }
  return { norm, map };
}

const normText = (s: string) => normalize(s).norm;

// Every text node under `root` (skipping our own overlay layer and non-content
// tags), concatenated, with each node's start offset.
function collect(root: Node): { text: string; segs: Seg[] } {
  const segs: Seg[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = (n as Text).parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
      if (p.closest("[data-hq-anchor-layer]")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    segs.push({ node: n as Text, start: text.length });
    text += (n as Text).data;
  }
  return { text, segs };
}

// raw offset → (text node, offset). `end` = true picks the node that OWNS the
// character before the offset (so a range end never lands at a node's offset 0).
function locate(segs: Seg[], raw: number, end = false): { node: Text; offset: number } | null {
  if (!segs.length) return null;
  let lo = 0, hi = segs.length - 1;
  const target = end ? raw - 1 : raw;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= target) lo = mid; else hi = mid - 1;
  }
  const s = segs[lo];
  const off = Math.max(0, Math.min(s.node.data.length, raw - s.start));
  return { node: s.node, offset: off };
}

// Describe a live Range as a re-findable quote. exact = the selection's own
// text; prefix/suffix = the CONTEXT chars around it (normalized).
export function describeRange(root: Node, range: Range): TextQuote {
  const exact = range.toString();
  const pre = document.createRange();
  pre.setStart(root, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const post = document.createRange();
  post.setStart(range.endContainer, range.endOffset);
  post.setEnd(root, root.childNodes.length);
  const prefix = normText(pre.toString().slice(-CONTEXT * 4)).slice(-CONTEXT);
  const suffix = normText(post.toString().slice(0, CONTEXT * 4)).slice(0, CONTEXT);
  return { exact, prefix, suffix };
}

// How many chars agree, walking outward from the boundary. Used to rank repeats.
function agreeBack(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function agreeFwd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Find a quote under `root` → a Range, or null. One walk of the subtree; when
// the exact text repeats, the occurrence whose surroundings best match the
// stored prefix/suffix wins.
export function findQuote(root: Node, q: TextQuote): Range | null {
  const needle = normText(q.exact);
  if (!needle) return null;
  const { text, segs } = collect(root);
  const { norm, map } = normalize(text);
  const hits: number[] = [];
  for (let i = norm.indexOf(needle); i !== -1 && hits.length < 64; i = norm.indexOf(needle, i + 1)) hits.push(i);
  if (!hits.length) return null;
  let best = hits[0];
  if (hits.length > 1) {
    let bestScore = -1;
    for (const h of hits) {
      const score =
        agreeBack(norm.slice(Math.max(0, h - CONTEXT), h), q.prefix) +
        agreeFwd(norm.slice(h + needle.length, h + needle.length + CONTEXT), q.suffix);
      if (score > bestScore) { bestScore = score; best = h; }
    }
  }
  const rawStart = map[best];
  const rawEnd = map[best + needle.length - 1] + 1;
  const s = locate(segs, rawStart);
  const e = locate(segs, rawEnd, true);
  if (!s || !e) return null;
  try {
    const r = document.createRange();
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, e.offset);
    return r;
  } catch {
    return null;
  }
}

// Same normalization the finder uses — for matching a quote block's text back to
// an anchor (e.g. a clicked blockquote in a user turn).
export const sameQuote = (a: string, b: string) => normText(a) === normText(b);

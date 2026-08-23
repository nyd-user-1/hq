"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { findQuote, sameQuote, type TextQuote } from "@/app/ui/text-anchor";

// ANCHORED QUESTIONS — the UI.
//
// The loop: select a passage anywhere in the transcript → right-click → "Quote
// into input" drops it into the send box as a `> blockquote` (the cursor lands on
// the next line, ready for the "-- huh?" that follows) → stack as many as you
// like → send. Nothing about the prompt is changed: quote + question go to Claude
// exactly as typed. What HQ adds is the RECORD (lib/anchors.ts) and, from it,
// three affordances over the live transcript:
//
//   1. A superscript ? in front of the passage, back where it was selected.
//      Hover (the ? or the passage) → a soft gray wash over the passage. Click →
//      a dotted underline + a small card: what you asked, and the beginning of
//      the answer, with "go to answer ↓".
//   2. On every Claude reply from then on, a hover-only ? (a sibling of the
//      block ⋮) opening the running INDEX of Q&A pairs: each row is a map-pin
//      (→ the passage) + the question (→ the answer). Questions asked five at a
//      time come back as pairs.
//   3. In your own turn, each blockquote is a link back to its passage.
//
// Highlights use the CSS Custom Highlight API (no DOM surgery — React owns the
// transcript DOM; we only paint over it), and the ? markers are an overlay layer
// positioned off each passage's first client rect, recomputed whenever the
// transcript mutates or resizes. Passages are re-found by text-quote
// (text-anchor.ts), so they survive re-renders, streaming, and markdown splits.

export type AnchorRecord = {
  id: string;
  createdAt: string;
  quote: TextQuote;
  sourceTurn?: string;
  question: string;
  sent: string;
};
export type PendingQuote = TextQuote & { sourceTurn?: string };
export type AnchorAnswer = { userIdx?: number; answerIdx?: number; answerText?: string };
export type AnchorLayerHandle = { jumpTo: (id: string) => void };

const uid = () => "a_" + Math.random().toString(36).slice(2, 10);
// "-- huh?" / "--- fix it." → "huh?" / "fix it." — the dashes are the user's own
// separator between quote and question; the question reads cleaner without them.
export const stripDashes = (q: string) => q.replace(/^\s*[-–—]+\s*/, "").trim();
export const quoteBlock = (text: string) =>
  text.trim().split(/\r?\n/).map((l) => `> ${l}`).join("\n");

// After a send: which of the pending quotes are still in the prompt (the user may
// have deleted one), in prompt order, each paired with the text that followed it
// up to the next quote — that text IS the question.
export function parseQuotesFromPrompt(prompt: string, pending: PendingQuote[]): AnchorRecord[] {
  const found: { idx: number; len: number; q: PendingQuote }[] = [];
  let from = 0;
  for (const q of pending) {
    const block = quoteBlock(q.exact);
    let idx = prompt.indexOf(block, from);
    let len = block.length;
    if (idx === -1) {
      // edited in the box — settle for its first line
      const first = block.split("\n")[0];
      idx = prompt.indexOf(first, from);
      len = first.length;
      if (idx === -1) continue;
    }
    found.push({ idx, len, q });
    from = idx + len;
  }
  found.sort((a, b) => a.idx - b.idx);
  const now = new Date().toISOString();
  return found.map((f, i) => {
    const end = i + 1 < found.length ? found[i + 1].idx : prompt.length;
    return {
      id: uid(),
      createdAt: now,
      quote: { exact: f.q.exact, prefix: f.q.prefix, suffix: f.q.suffix },
      sourceTurn: f.q.sourceTurn,
      question: prompt.slice(f.idx + f.len, end).trim(),
      sent: prompt,
    };
  });
}

// ── CSS Custom Highlight API (same access pattern as the find-in-page code) ──
type HighlightCtor = new (...ranges: Range[]) => object;
function highlightApi(): { reg: Map<string, object>; Ctor: HighlightCtor } | null {
  const reg = (CSS as unknown as { highlights?: Map<string, object> }).highlights;
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return reg && Ctor ? { reg, Ctor } : null;
}
function setHighlight(name: string, ranges: Range[]) {
  const api = highlightApi();
  if (!api) return;
  if (ranges.length) api.reg.set(name, new api.Ctor(...ranges));
  else api.reg.delete(name);
}
export const ANCHOR_HIGHLIGHT_CSS = `
/* Anchored questions (anchor-layer.tsx): hover wash + the clicked/pinned underline. */
::highlight(hq-anchor-hover) { background-color: rgba(161, 161, 170, 0.22); }
::highlight(hq-anchor-pin) { text-decoration: underline dotted rgba(249, 115, 22, 0.9); }`;

const SVG = {
  width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IconHelp = () => (
  <svg {...SVG} width={15} height={15}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);
const IconPin = () => (
  <svg {...SVG} width={13} height={13}>
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

// Close-on-outside / Escape / scroll, shared by the three floating surfaces.
function useDismiss(active: boolean, onClose: () => void, ignore?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => {
      if (ignore?.current && ignore.current.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [active, onClose, ignore]);
}

// ── the right-click menu over a selection ──
export function SelectionMenu({
  x, y, onQuote, onCopy, onClose,
}: { x: number; y: number; onQuote: () => void; onCopy: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(true, onClose, ref);
  if (typeof document === "undefined") return null;
  const left = Math.max(8, Math.min(x, window.innerWidth - 208));
  const top = Math.max(8, Math.min(y, window.innerHeight - 84));
  const row = "flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900";
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ top, left }}
      className="fixed z-50 flex w-48 flex-col whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-950 p-1 font-sans shadow-xl"
    >
      <button role="menuitem" onClick={onQuote} className={row}>
        <svg {...SVG}>
          <path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
          <path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z" />
        </svg>
        Quote into input
        <span className="ml-auto text-[10px] text-zinc-600">then ask</span>
      </button>
      <button role="menuitem" onClick={onCopy} className={row}>
        <svg {...SVG}>
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        Copy
      </button>
    </div>,
    document.body,
  );
}

// ── the overlay: ? markers, hover/pin highlights, the Q&A card ──
type Mark = { id: string; top: number; left: number };

export default function AnchorLayer({
  ref, containerRef, anchors, answers, onJumpAnswer, epoch,
}: {
  ref?: Ref<AnchorLayerHandle>;
  containerRef: RefObject<HTMLDivElement | null>; // the transcript scroll box (position: relative)
  anchors: AnchorRecord[];
  answers: Record<string, AnchorAnswer>; // anchor id → its paired turns (terminal resolves these)
  onJumpAnswer: (idx: number) => void;
  epoch: number; // bump to force a recompute (e.g. items.length)
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const rangesRef = useRef<Map<string, Range>>(new Map());
  const [marks, setMarks] = useState<Mark[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; top: number; left: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Re-find every anchor and re-measure its first rect. Cheap: one text walk of
  // the transcript + an indexOf per anchor. Marks only re-set when they moved.
  const recompute = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const cRect = c.getBoundingClientRect();
    const next: Mark[] = [];
    const map = new Map<string, Range>();
    for (const a of anchors) {
      const r = findQuote(c, a.quote);
      if (!r) continue;
      map.set(a.id, r);
      const rects = r.getClientRects();
      const first = rects.length ? rects[0] : r.getBoundingClientRect();
      if (!first || (first.width === 0 && first.height === 0)) continue; // inside a collapsed <details>
      next.push({ id: a.id, top: first.top - cRect.top + c.scrollTop, left: first.left - cRect.left + c.scrollLeft });
    }
    rangesRef.current = map;
    setMarks((prev) =>
      prev.length === next.length &&
      prev.every((m, i) => m.id === next[i].id && Math.abs(m.top - next[i].top) < 0.5 && Math.abs(m.left - next[i].left) < 0.5)
        ? prev
        : next,
    );
  }, [anchors, containerRef]);

  useLayoutEffect(() => { recompute(); }, [recompute, epoch]);

  // Follow the transcript: any mutation (streaming, a <details> opening, older
  // turns loading) or resize → recompute, throttled to one per frame, and never
  // for our own overlay's mutations (that would loop).
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    const mo = new MutationObserver((recs) => {
      const layer = layerRef.current;
      if (layer && recs.every((r) => layer.contains(r.target))) return;
      schedule();
    });
    mo.observe(c, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(c);
    c.addEventListener("toggle", schedule, true);
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      if (raf) cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
      c.removeEventListener("toggle", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, recompute]);

  // Paint: hover wash + pinned underline (open card or a jump flash).
  useEffect(() => {
    const r = (id: string | null) => (id ? rangesRef.current.get(id) : undefined);
    const hov = r(hovered);
    setHighlight("hq-anchor-hover", hov ? [hov] : []);
    const pins = [r(open?.id ?? null), r(flash)].filter((x): x is Range => !!x);
    setHighlight("hq-anchor-pin", pins);
  }, [hovered, open, flash, marks]);
  useEffect(() => () => { setHighlight("hq-anchor-hover", []); setHighlight("hq-anchor-pin", []); }, []);

  // Hovering / clicking the PASSAGE itself (not just the ?): hit-test the pointer
  // against each anchor's client rects. Exact, and cheap at one check per frame.
  const hit = useCallback((x: number, y: number): string | null => {
    for (const [id, r] of rangesRef.current) {
      const rects = r.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const q = rects[i];
        if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return id;
      }
    }
    return null;
  }, []);
  const openAt = useCallback((id: string, rect: DOMRect) => {
    setOpen({ id, top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - 348)) });
  }, []);
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-hq-anchor-layer]")) return; // the ? owns its own hover
      if (raf) return;
      const { clientX: x, clientY: y } = e;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const id = hit(x, y);
        setHovered((h) => (h === id ? h : id));
        c.style.cursor = id ? "pointer" : "";
      });
    };
    const leave = () => { setHovered(null); c.style.cursor = ""; };
    const click = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("a,button,input,textarea,summary,[data-hq-anchor-layer]")) return;
      const id = hit(e.clientX, e.clientY);
      if (!id) return;
      const r = rangesRef.current.get(id);
      const rect = r?.getClientRects()[0];
      if (rect) openAt(id, rect);
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("click", click);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("click", click);
      c.style.cursor = "";
    };
  }, [containerRef, hit, openAt]);

  const close = useCallback(() => setOpen(null), []);
  useDismiss(!!open, close, cardRef);

  // Scroll the passage into view (upper third) and flash its underline.
  const jumpTo = useCallback((id: string) => {
    let r = rangesRef.current.get(id);
    if (!r) { recompute(); r = rangesRef.current.get(id); }
    const c = containerRef.current;
    if (!r || !c) return;
    const rect = r.getBoundingClientRect();
    const cRect = c.getBoundingClientRect();
    c.scrollTo({ top: rect.top - cRect.top + c.scrollTop - Math.round(c.clientHeight * 0.3), behavior: "smooth" });
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
  }, [containerRef, recompute]);
  useImperativeHandle(ref, () => ({ jumpTo }), [jumpTo]);

  const openAnchor = open ? anchors.find((a) => a.id === open.id) : undefined;
  const openAnswer = open ? answers[open.id] : undefined;

  return (
    <div ref={layerRef} data-hq-anchor-layer className="pointer-events-none absolute inset-0 z-10">
      {marks.map((m) => (
        <button
          key={m.id}
          type="button"
          style={{ top: m.top - 3, left: m.left - 10 }}
          onMouseEnter={() => setHovered(m.id)}
          onMouseLeave={() => setHovered((h) => (h === m.id ? null : h))}
          onClick={(e) => { e.stopPropagation(); openAt(m.id, e.currentTarget.getBoundingClientRect()); }}
          title="you asked about this passage — click to see the question and its answer"
          aria-label="anchored question"
          className={`pointer-events-auto absolute select-none font-sans text-[10px] font-bold leading-none transition-colors ${
            open?.id === m.id ? "text-orange-300" : "text-orange-500 hover:text-orange-300"
          }`}
        >
          ?
        </button>
      ))}
      {open && openAnchor && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            style={{ top: open.top, left: open.left }}
            className="pointer-events-auto fixed z-50 flex w-[21rem] flex-col gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px] shadow-xl"
          >
            <div className="text-[10px] uppercase tracking-wider text-zinc-600">you asked</div>
            <div className="whitespace-pre-wrap text-zinc-200">{stripDashes(openAnchor.question) || <span className="text-zinc-500">(quoted without a question)</span>}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-zinc-600">claude answered</div>
            <div className="line-clamp-4 text-zinc-400">
              {openAnswer?.answerText ? openAnswer.answerText.replace(/\s+/g, " ").slice(0, 320) : <span className="text-zinc-600">answer pending…</span>}
            </div>
            {openAnswer?.answerIdx != null && (
              <button
                type="button"
                onClick={() => { onJumpAnswer(openAnswer.answerIdx!); close(); }}
                className="mt-1 self-start rounded px-1.5 py-0.5 text-[11px] text-orange-400 transition-colors hover:bg-zinc-900 hover:text-orange-300"
              >
                go to answer ↓
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── the per-reply ? — the running index of Q&A pairs (a sibling of the block ⋮) ──
export function AnchorIndexMenu({
  entries, onJumpSource, onJumpAnswer,
  triggerClass = "absolute right-8 top-2",
  revealClass = "opacity-0 group-hover/turn:opacity-100",
}: {
  entries: { anchor: AnchorRecord; answerIdx?: number }[];
  onJumpSource: (id: string) => void;
  onJumpAnswer: (idx: number) => void;
  triggerClass?: string;
  revealClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, menuRef);
  if (!entries.length) return null;
  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };
  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Questions asked so far"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${entries.length} question${entries.length === 1 ? "" : "s"} asked so far — each links to its passage and its answer`}
        className={`${triggerClass} rounded p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 focus:opacity-100 ${open ? "opacity-100" : revealClass}`}
      >
        <IconHelp />
      </button>
      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 flex w-[22rem] flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 font-sans shadow-xl"
          >
            <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
              questions · {entries.length}
            </div>
            <div className="scrollbar-none flex max-h-72 flex-col overflow-y-auto">
              {entries.map(({ anchor, answerIdx }, i) => (
                <div key={anchor.id} className="flex items-start gap-2 rounded px-2 py-1.5 transition-colors hover:bg-zinc-900">
                  <button
                    type="button"
                    title="go to the passage"
                    onClick={() => { onJumpSource(anchor.id); setOpen(false); }}
                    className="mt-0.5 shrink-0 rounded p-0.5 text-orange-500 transition-colors hover:bg-zinc-800 hover:text-orange-300"
                  >
                    <IconPin />
                  </button>
                  <button
                    type="button"
                    title={answerIdx != null ? "go to the answer" : "answer pending"}
                    onClick={() => { if (answerIdx != null) onJumpAnswer(answerIdx); setOpen(false); }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-xs text-zinc-200">
                      <span className="mr-1.5 text-zinc-600">{i + 1}.</span>
                      {stripDashes(anchor.question) || <span className="text-zinc-500">(quoted without a question)</span>}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-zinc-500">
                      “{anchor.quote.exact.replace(/\s+/g, " ").slice(0, 90)}”
                    </span>
                  </button>
                  <span className="mt-0.5 shrink-0 text-[10px] text-zinc-600">{answerIdx != null ? "answer ↓" : "…"}</span>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── a user turn's text, with `> quote` lines drawn as quote blocks that link back ──
const isQuoteLine = (l: string) => /^>\s?/.test(l);
export function UserText({ text, onQuote }: { text: string; onQuote?: (quote: string) => void }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    if (isQuoteLine(lines[i])) {
      const q: string[] = [];
      while (i < lines.length && isQuoteLine(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      const quote = q.join("\n");
      out.push(
        <span
          key={key++}
          role={onQuote ? "link" : undefined}
          onClick={onQuote ? () => onQuote(quote) : undefined}
          title={onQuote ? "go to this passage" : undefined}
          className={`my-0.5 block border-l-2 border-orange-500/60 pl-2 text-zinc-400 ${onQuote ? "cursor-pointer transition-colors hover:border-orange-400 hover:text-zinc-200" : ""}`}
        >
          {quote}
        </span>,
      );
    } else {
      const plain: string[] = [];
      while (i < lines.length && !isQuoteLine(lines[i])) plain.push(lines[i++]);
      out.push(<span key={key++}>{plain.join("\n")}</span>);
    }
  }
  return <>{out}</>;
}

// A clicked blockquote → which anchor is it? (normalized text equality)
export function anchorForQuote(anchors: AnchorRecord[], quote: string): AnchorRecord | undefined {
  return anchors.find((a) => sameQuote(a.quote.exact, quote));
}

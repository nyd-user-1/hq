"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// A from-scratch, dependency-free dashboard grid (hq ships only next/react/react-
// dom — no react-grid-layout). Widgets snap to a 12-col grid: drag from the hover
// grip, resize from the corner handle, a faint background grid guides the eye, and
// the layout persists to localStorage. Auto-reflow: the dragged/resized card is the
// anchor and any card it overlaps is pushed straight down (cascading), so growing a
// KPI or the series chart slides the cards below down — never overlap. Fire
// `hq:fleet-grid-reset` to reset.
export type GridItem = { id: string; w: number; h: number; minW?: number; node: React.ReactNode };
type Box = { x: number; y: number; w: number; h: number };

const COLS = 12;
const ROW = 24; // px per grid row
const MINW = 2;
const MINH = 2;

// Shelf-pack the items in reading order → a sensible default that mirrors the
// static layout (KPI band across the top, shape cards below).
function defaults(items: GridItem[]): Record<string, Box> {
  const out: Record<string, Box> = {};
  let cx = 0,
    cy = 0,
    rowH = 0;
  for (const it of items) {
    const w = Math.min(COLS, it.w);
    if (cx + w > COLS) {
      cx = 0;
      cy += rowH;
      rowH = 0;
    }
    out[it.id] = { x: cx, y: cy, w, h: it.h };
    cx += w;
    rowH = Math.max(rowH, it.h);
  }
  return out;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Collision resolution: the `anchor` (the card being dragged/resized) stays put;
// every box it overlaps is pushed straight DOWN until it clears, cascading so a
// pushed box in turn shoves whatever sits below it. O(n²·passes) — trivial at
// dashboard scale (~10 cards). Grow a KPI or the series chart and the cards below
// slide down instead of overlapping.
function resolve(input: Record<string, Box>, anchorId: string): Record<string, Box> {
  const boxes: Record<string, Box> = {};
  for (const k of Object.keys(input)) boxes[k] = { ...input[k] };
  const ids = Object.keys(boxes);
  let guard = 0;
  let moved = true;
  while (moved && guard++ < 200) {
    moved = false;
    const order = ids.slice().sort((a, b) => {
      if (a === anchorId) return -1;
      if (b === anchorId) return 1;
      return boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x;
    });
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const A = boxes[order[i]];
        const B = boxes[order[j]];
        if (overlaps(A, B)) {
          boxes[order[j]] = { ...B, y: A.y + A.h };
          moved = true;
        }
      }
    }
  }
  return boxes;
}

export default function FleetGrid({ items, storageKey }: { items: GridItem[]; storageKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cellW, setCellW] = useState(0);
  const [layout, setLayout] = useState<Record<string, Box>>(() => defaults(items));
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; box: Box } | null>(null);
  const startRef = useRef<{ px: number; py: number; box: Box; minW: number } | null>(null);

  // load saved layout once; merge over defaults so a new widget id still places
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved && typeof saved === "object") setLayout((d) => ({ ...d, ...saved }));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  // any item missing a box (first paint / new id) gets its default
  const idKey = items.map((i) => i.id).join(",");
  useEffect(() => {
    setLayout((cur) => {
      const def = defaults(items);
      let changed = false;
      const next = { ...cur };
      for (const it of items)
        if (!next[it.id]) {
          next[it.id] = def[it.id];
          changed = true;
        }
      return changed ? next : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  // reset hook — re-subscribes per render so it always sees the live items
  useEffect(() => {
    const reset = () => {
      setLayout(defaults(items));
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("hq:fleet-grid-reset", reset);
    return () => window.removeEventListener("hq:fleet-grid-reset", reset);
  }, [items, storageKey]);

  // measure the grid width → cell width
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const m = () => setCellW(el.clientWidth / COLS);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const persist = useCallback(
    (l: Record<string, Box>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(l));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const onDown = (e: React.PointerEvent, id: string, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = { px: e.clientX, py: e.clientY, box: layout[id], minW: items.find((i) => i.id === id)?.minW ?? MINW };
    setDrag({ id, mode, box: layout[id] });
  };

  // Click-and-HOLD to pick up the whole block: a press engages the move after a
  // short hold (150ms) OR as soon as the pointer travels a few px — whichever
  // comes first — so a plain click never nudges the layout.
  const startHold = (e: React.PointerEvent, id: string) => {
    const px = e.clientX;
    const py = e.clientY;
    let timer = 0;
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    function engage() {
      cleanup();
      startRef.current = { px, py, box: layout[id], minW: items.find((i) => i.id === id)?.minW ?? MINW };
      setDrag({ id, mode: "move", box: layout[id] });
    }
    function onMove(ev: PointerEvent) {
      if (Math.hypot(ev.clientX - px, ev.clientY - py) > 4) engage();
    }
    function onUp() {
      cleanup();
    }
    timer = window.setTimeout(engage, 150);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // window-level move/up so the drag survives leaving the widget
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const st = startRef.current;
      if (!st || !cellW) return;
      const dx = Math.round((e.clientX - st.px) / cellW);
      const dy = Math.round((e.clientY - st.py) / ROW);
      const box: Box =
        drag.mode === "move"
          ? {
              ...st.box,
              x: Math.max(0, Math.min(COLS - st.box.w, st.box.x + dx)),
              y: Math.max(0, st.box.y + dy),
            }
          : {
              ...st.box,
              w: Math.max(st.minW, Math.min(COLS - st.box.x, st.box.w + dx)),
              h: Math.max(MINH, st.box.h + dy),
            };
      setDrag((d) => (d ? { ...d, box } : d));
    };
    const up = () => {
      setDrag((d) => {
        if (d)
          setLayout((cur) => {
            const next = resolve({ ...cur, [d.id]: d.box }, d.id);
            persist(next);
            return next;
          });
        return null;
      });
      startRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, cellW, persist]);

  // Live view: while dragging, merge the anchor's in-progress box and resolve
  // collisions so the cards below reflow in real time. Idle = the committed layout
  // (already collision-free from the last commit).
  const view = drag ? resolve({ ...layout, [drag.id]: drag.box }, drag.id) : layout;

  const height = Math.max(
    0,
    ...items.map((it) => {
      const b = view[it.id];
      return b ? (b.y + b.h) * ROW : 0;
    }),
  );

  return (
    <div ref={ref} className="relative w-full" style={{ height: `max(${height}px, 100%)` }}>
      {/* faint guide grid — brighter while dragging */}
      <div
        className="pointer-events-none absolute inset-0 rounded"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(113,113,122,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(113,113,122,0.11) 1px, transparent 1px)",
          backgroundSize: `${cellW}px ${ROW}px`,
          opacity: cellW ? (drag ? 1 : 0.7) : 0,
        }}
      />
      {items.map((it) => {
        const box = view[it.id];
        if (!box || !cellW) return null;
        const dragging = drag?.id === it.id;
        return (
          <div
            key={it.id}
            className={`absolute p-1 ${
              dragging
                ? "z-20"
                : "z-10 transition-[left,top,width,height] duration-100 motion-reduce:transition-none"
            }`}
            style={{ left: box.x * cellW, top: box.y * ROW, width: box.w * cellW, height: box.h * ROW }}
          >
            <div
              onPointerDown={(e) => startHold(e, it.id)}
              title="click and hold to drag"
              className={`group/w relative h-full select-none rounded-lg ring-1 transition ${
                dragging
                  ? "cursor-grabbing opacity-90 ring-zinc-600"
                  : "cursor-grab ring-transparent hover:ring-zinc-600"
              }`}
            >
              {it.node}
              {/* drag grip — kebab-style button; white once the drag is active */}
              <button
                type="button"
                onPointerDown={(e) => onDown(e, it.id, "move")}
                title="drag to move"
                aria-label="move block"
                className={`absolute right-1 top-1 cursor-grab touch-none rounded p-1 transition ${
                  dragging
                    ? "bg-zinc-800 text-white opacity-100"
                    : "text-zinc-400 opacity-0 hover:bg-zinc-800 hover:text-white group-hover/w:opacity-100"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <circle cx="8" cy="6" r="1.6" />
                  <circle cx="8" cy="12" r="1.6" />
                  <circle cx="8" cy="18" r="1.6" />
                  <circle cx="16" cy="6" r="1.6" />
                  <circle cx="16" cy="12" r="1.6" />
                  <circle cx="16" cy="18" r="1.6" />
                </svg>
              </button>
              {/* resize handle — kebab-style button, corner-grip glyph */}
              <button
                type="button"
                onPointerDown={(e) => onDown(e, it.id, "resize")}
                title="drag to resize"
                aria-label="resize block"
                className="absolute bottom-1 right-1 cursor-se-resize touch-none rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-800 hover:text-white group-hover/w:opacity-100"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M20 10 L10 20" />
                  <path d="M20 15 L15 20" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

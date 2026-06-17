"use client";

import { useEffect, useRef, useState } from "react";
import AccordionItem, { CopyGlyph } from "@/app/ui/accordion-item";
import MetaChipRow from "@/app/ui/meta-chip-row";
import SearchField from "@/app/ui/search-field";
import SortIcon from "@/app/ui/sort-icon";

type SortMode = "manual" | "new" | "old";

type Item = {
  name: string;
  file: string;
  kind: "presentational" | "container";
  status: "approved" | "review";
  desc: string;
  code: string;
  id: string;
  session: string;
  createdAt: number;
};

// Kind → the colored pill, reusing the To Do category-chip palette.
const KIND_TAG: Record<Item["kind"], { label: string; chipClass: string }> = {
  presentational: { label: "Presentational", chipClass: "bg-sky-500/15 text-sky-300" },
  container: { label: "Container", chipClass: "bg-violet-500/15 text-violet-300" },
};

// The Components registry view — first real consumer of AccordionItem outside To
// Do. Each component is an accordion card (provenance: ● claude · file path ·
// kind pill; the name as the draggable label; the source as the body). Drag a
// card into a terminal (drops the file path) or onto a sibling to reorder
// (persisted via /api/components). Approved (blue) sits above Review (red).
export default function ComponentsList({ items: initial }: { items: Item[] }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    pos: "before" | "after";
  } | null>(null);
  const [sort, setSort] = useState<SortMode>("manual"); // manual = saved drag order
  const [kind, setKind] = useState<Item["kind"] | null>(null); // active kind filter
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close the kind-filter dropdown on an outside click or Escape.
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  const q = query.trim().toLowerCase();
  const match = (c: Item) =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.desc.toLowerCase().includes(q) ||
    c.file.toLowerCase().includes(q);
  // Search + kind filter + timestamp sort (manual = saved drag order). Drag is
  // only allowed in the unfiltered manual view (same rule as To Do).
  const visible = (status: Item["status"]) => {
    const arr = items.filter(
      (c) =>
        c.status === status && match(c) && (kind === null || c.kind === kind)
    );
    return sort === "manual"
      ? arr
      : [...arr].sort((a, b) =>
          sort === "new" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
        );
  };
  const approved = visible("approved");
  const review = visible("review");
  const canReorder = sort === "manual" && kind === null;

  function toggleExpand(name: string) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  function copy(c: Item) {
    navigator.clipboard.writeText(c.code);
    setCopied(c.name);
    setTimeout(() => setCopied((x) => (x === c.name ? null : x)), 1200);
  }

  function reorder(targetId: string, pos: "before" | "after") {
    if (!draggingId || draggingId === targetId) return;
    const order = items.map((i) => i.name).filter((n) => n !== draggingId);
    let at = order.indexOf(targetId);
    if (at < 0) return;
    if (pos === "after") at += 1;
    order.splice(at, 0, draggingId);
    const byName = new Map(items.map((i) => [i.name, i]));
    setItems(order.map((n) => byName.get(n)!));
    fetch("/api/components", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }).catch(() => {});
  }

  const card = (c: Item) => (
    <AccordionItem
      key={c.name}
      who="claude"
      dotClass="text-orange-500"
      tag={kind !== null ? KIND_TAG[c.kind] : undefined}
      label={c.name}
      fillLabel
      expandable={!!c.code}
      open={expanded.has(c.name)}
      onToggleExpand={() => toggleExpand(c.name)}
      dragText={c.file}
      dragId={c.name}
      dragSourceId={draggingId}
      dropEdge={dropTarget?.id === c.name ? dropTarget.pos : null}
      reorderEnabled={canReorder}
      onDragStart={() => setDraggingId(c.name)}
      onDragEnd={() => {
        setDraggingId(null);
        setDropTarget(null);
      }}
      onDragOverEdge={(pos) =>
        setDropTarget((d) =>
          d?.id === c.name && d.pos === pos ? d : { id: c.name, pos }
        )
      }
      onDropEdge={(pos) => {
        reorder(c.name, pos);
        setDropTarget(null);
        setDraggingId(null);
      }}
    >
      <div className="group/code relative">
        <button
          onClick={() => copy(c)}
          title="copy source"
          aria-label="Copy source"
          className="absolute right-2 top-2 z-10 rounded bg-zinc-900/80 p-1 text-zinc-500 opacity-0 transition hover:text-zinc-200 focus:opacity-100 group-hover/code:opacity-100"
        >
          {copied === c.name ? (
            <span className="text-[10px] text-green-400">✓</span>
          ) : (
            <CopyGlyph />
          )}
        </button>
        <pre className="scrollbar-none max-h-[420px] overflow-auto whitespace-pre text-[10px] leading-relaxed text-zinc-400">
          {c.code || "— source unavailable —"}
        </pre>
      </div>
      <MetaChipRow
        divider
        items={[
          { label: "Component", value: c.id },
          { label: "via session", value: c.session.slice(0, 8), copyText: c.session },
          { label: "at", value: new Date(c.createdAt).toLocaleTimeString() },
          { label: "Path:", value: c.file },
        ]}
      />
    </AccordionItem>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Header — mirrors To Do / Projects: search, then a row with the Filter
          dropdown (left, model-button styling) and the sort + new buttons right. */}
      <div className="flex flex-col gap-1.5">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search components…"
        />
        <div className="flex items-center gap-2">
          {/* Filter — model-button styling; the kind dropdown's trigger, opening
              bottom-left. Shows the active kind, else "Filter". */}
          <div ref={filterRef} className="relative">
            <button
              onClick={() => setFilterOpen((o) => !o)}
              title="filter by kind"
              aria-label="Filter by kind"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              className="flex max-w-full items-center rounded-md px-1.5 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <span className="truncate">
                {kind ? KIND_TAG[kind].label : "Filter"}
              </span>
            </button>
            {filterOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full z-30 mt-1 flex w-44 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-xl"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setKind(null);
                    setFilterOpen(false);
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                >
                  <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                    All
                  </span>
                  {kind === null && (
                    <span className="ml-auto text-xs text-blue-400">✓</span>
                  )}
                </button>
                {(["presentational", "container"] as const).map((k) => (
                  <button
                    key={k}
                    role="menuitem"
                    onClick={() => {
                      setKind((p) => (p === k ? null : k));
                      setFilterOpen(false);
                    }}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-zinc-900"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${KIND_TAG[k].chipClass}`}
                    >
                      {KIND_TAG[k].label}
                    </span>
                    {kind === k && (
                      <span className="ml-auto text-xs text-blue-400">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() =>
                setSort((s) =>
                  s === "manual" ? "new" : s === "new" ? "old" : "manual"
                )
              }
              title={
                sort === "manual"
                  ? "Manual order — drag to reorder. Click to sort newest first."
                  : sort === "new"
                    ? "Sorted newest first — click for oldest. Sorting overrides the manual drag order."
                    : "Sorted oldest first — click to return to manual drag order."
              }
              aria-label="Toggle sort order"
              aria-pressed={sort !== "manual"}
              className={`flex shrink-0 items-center rounded-md p-1.5 transition-colors ${
                sort === "manual"
                  ? "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  : "bg-zinc-800 text-zinc-100"
              }`}
            >
              <SortIcon dir={sort === "old" ? "old" : "new"} />
            </button>
            <button
              title="New component — coming next"
              aria-label="New component"
              className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {approved.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-blue-400">
              Approved
            </h2>
            <ol className="flex list-none flex-col gap-3">
              {approved.map(card)}
            </ol>
          </section>
        )}

        {review.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-red-400">
              Review
            </h2>
            <ol className="flex list-none flex-col gap-3">{review.map(card)}</ol>
          </section>
        )}

        {approved.length === 0 && review.length === 0 && (
          <p className="text-sm text-zinc-600">no components match “{query}”.</p>
        )}
      </div>

      {/* Footer — the drag hint, moved out of the header caption. */}
      <p className="text-xs text-zinc-600">*Drag cards to chat or reorder.</p>
    </div>
  );
}

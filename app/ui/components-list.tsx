"use client";

import { useState } from "react";
import AccordionItem, { CopyGlyph } from "@/app/ui/accordion-item";
import MetaChipRow from "@/app/ui/meta-chip-row";
import SearchField from "@/app/ui/search-field";

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

  const q = query.trim().toLowerCase();
  const match = (c: Item) =>
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.desc.toLowerCase().includes(q) ||
    c.file.toLowerCase().includes(q);
  const approved = items.filter((c) => c.status === "approved" && match(c));
  const review = items.filter((c) => c.status === "review" && match(c));

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
      tag={KIND_TAG[c.kind]}
      label={c.name}
      fillLabel
      expandable={!!c.code}
      open={expanded.has(c.name)}
      onToggleExpand={() => toggleExpand(c.name)}
      dragText={c.file}
      dragId={c.name}
      dragSourceId={draggingId}
      dropEdge={dropTarget?.id === c.name ? dropTarget.pos : null}
      reorderEnabled
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
    <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <div className="flex flex-col gap-1.5">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search components…"
        />
        <p className="text-[11px] text-zinc-500">
          *Drag cards to chat or reorder.
        </p>
      </div>

      {approved.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-blue-400">
            Approved
          </h2>
          <ol className="flex list-none flex-col gap-3">{approved.map(card)}</ol>
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
  );
}

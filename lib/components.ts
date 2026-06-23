import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { getFiles } from "./files";
import { writeFileAtomicSync } from "./atomic";

// The HQ component registry — hand-curated (approval is a human judgment, not
// something you can derive from disk). APPROVED = reviewed, named per the
// [Category][Descriptor][Element] taxonomy, single-responsibility, reusable.
// REVIEW = exists in app/ui but hasn't been audited into the design system yet.
// This is the first real index for the component-library effort; the Components
// panel reads it.
export type ComponentKind = "presentational" | "container";
export type ComponentStatus = "approved" | "review";

export type ComponentEntry = {
  name: string;
  file: string;
  kind: ComponentKind;
  status: ComponentStatus;
  desc: string;
};

export const COMPONENTS: ComponentEntry[] = [
  // ── Approved ──────────────────────────────────────────────────────────────
  { name: "TabNav", file: "app/ui/tab-nav.tsx", kind: "presentational", status: "approved", desc: "Panel tab bar — active/inactive pills; carries the terminal pins across nav." },
  { name: "Boundary", file: "app/ui/boundary.tsx", kind: "presentational", status: "approved", desc: "Dashed route-anatomy frame with a file-path chip + lead/trail slots." },
  { name: "BoundaryChip", file: "app/ui/boundary-chip.tsx", kind: "presentational", status: "approved", desc: "Click-to-copy file-path chip that sits on a Boundary." },
  { name: "CopyCode", file: "app/ui/copy-code.tsx", kind: "presentational", status: "approved", desc: "Inline code chip, click-to-copy; optional copyText (show short, copy full)." },
  { name: "MetaChipRow", file: "app/ui/meta-chip-row.tsx", kind: "presentational", status: "approved", desc: "Row of labeled copy chips — {label, value, copyText?}[]; optional divider." },
  { name: "AccordionItem", file: "app/ui/accordion-item.tsx", kind: "presentational", status: "approved", desc: "The generic collapsible card — provenance header, disclosure, drag-to-terminal + reorder; AccordionTodoItem wraps it." },
  { name: "AccordionTodoItem", file: "app/ui/accordion-todo-item.tsx", kind: "presentational", status: "approved", desc: "Collapsible to-do card — provenance header, disclosure body, MetaChipRow footer." },
  { name: "ButtonChipIcon", file: "app/ui/button-chip-icon.tsx", kind: "presentational", status: "approved", desc: "Square icon chip-button — sidebar toggle, search, panel expand/close all use it." },
  { name: "ButtonChipAction", file: "app/ui/button-chip-action.tsx", kind: "presentational", status: "approved", desc: "“+ label” action chip with an accent — the send box's + attach / + todo." },
  { name: "SearchField", file: "app/ui/search-field.tsx", kind: "presentational", status: "approved", desc: "Generic controlled search box (value/onChange) — the Components filter uses it." },
  { name: "PanelMenu", file: "app/ui/panel-menu.tsx", kind: "presentational", status: "approved", desc: "BoundaryChip variant (▼) opening Activity/Metrics/Console/Compose; dashed menu + info-circle chip." },
  { name: "CommitLink", file: "app/ui/commit-link.tsx", kind: "presentational", status: "approved", desc: "Chat-reply sha chip → opens the diff in Shipped, carrying the terminal pins (withPins)." },
  { name: "Markdown", file: "app/ui/md.tsx", kind: "presentational", status: "approved", desc: "Lightweight markdown renderer; emits CopyCode for inline code." },
  { name: "CopyText", file: "app/ui/copy-text.tsx", kind: "presentational", status: "approved", desc: "Click-to-copy text wrapper — overlaps CopyCode; candidate to fold into the copy-chip family." },
  { name: "CollapsibleBoundary", file: "app/ui/collapsible-boundary.tsx", kind: "presentational", status: "approved", desc: "Boundary variant that collapses — candidate to fold into Boundary." },
  { name: "Tooltip", file: "app/ui/tooltip.tsx", kind: "presentational", status: "approved", desc: "Custom dark hover tooltip — portaled chip; wrap a trigger, placement top/bottom/right." },
  { name: "Button", file: "app/ui/button.tsx", kind: "presentational", status: "approved", desc: "General-purpose button — primary/secondary/ghost/danger × sm/md; spreads native button props. The non-chip button hq was missing." },
  { name: "Menu", file: "app/ui/menu.tsx", kind: "presentational", status: "approved", desc: "Anchored dropdown — portaled, outside-click/Esc/scroll dismiss; wrap MenuItem rows. Generalizes the 9-file hand-rolled menu pattern." },
  { name: "Icon", file: "app/ui/icons.tsx", kind: "presentational", status: "approved", desc: "Lucide-style icon set — <Icon name=…/> on a 24-grid; one source per glyph, replacing 102 inline <svg>s. (icons.tsx — icon.tsx is a reserved Next metadata name.)" },

  // ── Review ────────────────────────────────────────────────────────────────
  { name: "Terminal", file: "app/ui/terminal.tsx", kind: "container", status: "review", desc: "The persistent center pane — stream, send box, header, panels dropdown. Huge; ripe for sub-extraction." },
  { name: "Shell", file: "app/ui/shell.tsx", kind: "container", status: "review", desc: "Root three-column layout (sidebar · terminal · panel)." },
  { name: "AppPanel", file: "app/ui/app-panel.tsx", kind: "container", status: "review", desc: "Right slide-in panel portal; owns expand/close state (now uses ButtonChipIcon)." },
  { name: "PanelWrapper", file: "app/ui/panel-wrapper.tsx", kind: "container", status: "review", desc: "Reads the route to decide if the panel is open; mounts AppPanel." },
  { name: "TodoList", file: "app/ui/todo-list.tsx", kind: "container", status: "review", desc: "To Do container — list state + persistence; renders AccordionTodoItem rows." },
  { name: "Sidebar", file: "app/ui/sidebar.tsx", kind: "container", status: "review", desc: "Left rail — nameplate, new-session, Recents." },
  { name: "SidebarRecents", file: "app/ui/sidebar-recents.tsx", kind: "container", status: "review", desc: "Recent-sessions list with favorite/hide/rename kebab." },
  { name: "SidebarColumn", file: "app/ui/sidebar-column.tsx", kind: "presentational", status: "review", desc: "Collapsible width wrapper for the sidebar." },
  { name: "PairColumn", file: "app/ui/pair-column.tsx", kind: "container", status: "review", desc: "Terminal 2 column (pair mode); has its own close button." },
  { name: "ComposeTray", file: "app/ui/compose-tray.tsx", kind: "container", status: "review", desc: "Compose drag-in tray; send-to-terminal." },
  { name: "SkillLauncher", file: "app/ui/skill-launcher.tsx", kind: "container", status: "review", desc: "Skill browser + command box — this panel borrows its row pattern." },
  { name: "RoutinePanel", file: "app/ui/routine-panel.tsx", kind: "container", status: "review", desc: "Routines panel." },  { name: "TokenMeter", file: "app/ui/token-meter.tsx", kind: "presentational", status: "review", desc: "Token / $ meter rendering." },
  { name: "ForecastMeter", file: "app/ui/forecast-meter.tsx", kind: "presentational", status: "review", desc: "Forecast gauge." },
  { name: "Efficiency", file: "app/ui/efficiency.tsx", kind: "presentational", status: "review", desc: "Efficiency Mode strip / toggle." },  { name: "BackLink", file: "app/ui/back-link.tsx", kind: "presentational", status: "review", desc: "Panel back link (push + refresh) — the parallel-route back-nav fix." },
  { name: "FlashOnNav", file: "app/ui/flash-on-nav.tsx", kind: "presentational", status: "review", desc: "Flashes the boundary on route change." },  { name: "SearchInput", file: "app/ui/search-input.tsx", kind: "presentational", status: "review", desc: "Route-coupled global search box (debounces into /search) — candidate to rebuild on SearchField." },
  { name: "NewSessionItem", file: "app/ui/new-session-item.tsx", kind: "presentational", status: "review", desc: "“+ New Session” row." },
  { name: "NoteBody", file: "app/ui/note-body.tsx", kind: "presentational", status: "review", desc: "Saved note-block body." },
  { name: "SidebarToggle", file: "app/ui/sidebar-toggle.tsx", kind: "presentational", status: "review", desc: "Variant of ButtonChipIcon — the boundary sidebar toggle." },
  { name: "SearchTrigger", file: "app/ui/search-trigger.tsx", kind: "presentational", status: "review", desc: "Variant of ButtonChipIcon — opens/closes the Search panel (active state)." },
  { name: "TextEditor", file: "app/ui/text-editor.tsx", kind: "container", status: "review", desc: "Full-screen capture modal (opened from the panel-menu “Text” item) — paste text, ↵ saves it as a searchable HQ note (POST /api/notes)." },
  { name: "CommandPalette", file: "app/ui/command-palette.tsx", kind: "container", status: "review", desc: "⌘K launcher — ranked + grouped Actions/Navigate commands; keyboard-driven; nav carries the terminal pins (withPins)." },];

// Registry provenance — like a to-do, each entry records the session that added
// it and when. This whole registry was authored in one session, so they share
// these (honest registry-add provenance, not original file authorship).
export const REGISTRY_SESSION = "e47af370-918d-4e9b-919d-936eb99b9ce5";
export const REGISTRY_CREATED_AT = 1781482600000;

// A stable c_ id derived from the component name (the c_ analogue of a to-do's
// t_ id) — deterministic, so it never shifts between renders.
export function componentId(name: string): string {
  return "c_" + createHash("sha1").update(name).digest("hex").slice(0, 10);
}

// The source of a registered component, read from disk (the file lives in the
// repo; HQ is localhost). Every registered component lives under app/ui, so the
// read is statically scoped there (static prefix + dynamic basename) — that
// keeps the build's file-tracer from slurping the whole project. Empty string
// if it can't be read.
export function readComponentSource(file: string): string {
  try {
    return fs.readFileSync(
      path.join(process.cwd(), "app", "ui", path.basename(file)),
      "utf8"
    );
  } catch {
    return "";
  }
}

// Reorder is persisted to an HQ-native sidecar (same "disk is the database"
// pattern as todo.json) — an array of component names in display order.
const ORDER_FILE = path.join(
  os.homedir(),
  ".claude",
  "hq",
  "components-order.json"
);

function readOrder(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ORDER_FILE, "utf8"));
    return Array.isArray(parsed.order) ? parsed.order : [];
  } catch {
    return [];
  }
}

export function saveComponentsOrder(order: string[]): void {
  writeFileAtomicSync(ORDER_FILE, JSON.stringify({ order }, null, 2)); // atomic — CODE-REVIEW BUG-1
}

// Auto-discovery — every app/ui/*.tsx that ISN'T in the hand-curated registry
// yet, surfaced via the shared file index (lib/files.ts). This is the registry's
// "review backlog": the index finds candidates automatically so the curated list
// stops silently lagging the directory. Promotion into COMPONENTS stays a human
// act (approval is judgment, not derivable from disk).
export function undiscoveredComponents(): { file: string; name: string }[] {
  const known = new Set(COMPONENTS.map((c) => c.file));
  return getFiles()
    .filter(
      (f) => f.rel.startsWith("app/ui/") && f.ext === "tsx" && !known.has(f.rel)
    )
    .map((f) => ({ file: f.rel, name: f.name.replace(/\.tsx$/, "") }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

// Registry in the saved display order; names absent from the sidecar keep their
// registry position (appended after the ordered ones). Stable.
export function orderedComponents(): ComponentEntry[] {
  const order = readOrder();
  if (!order.length) return COMPONENTS;
  const rank = new Map(order.map((n, i) => [n, i]));
  return [...COMPONENTS].sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name)! : Infinity;
    const rb = rank.has(b.name) ? rank.get(b.name)! : Infinity;
    if (ra !== rb) return ra - rb;
    return COMPONENTS.indexOf(a) - COMPONENTS.indexOf(b);
  });
}

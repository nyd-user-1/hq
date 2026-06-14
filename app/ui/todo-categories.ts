// Shared To Do categories — the filter chips (TodoList) and the per-card tag
// (AccordionTodoItem) both read these, so they live in one place to avoid a
// container↔card import cycle. `key` is what's stored; label/chip are
// presentation. Add more here as new kinds of work surface.
export const CATEGORIES = [
  { key: "efficiency", label: "Efficiency", chip: "bg-emerald-500/15 text-emerald-300" },
  { key: "ui", label: "UI/UX", chip: "bg-sky-500/15 text-sky-300" },
  { key: "functionality", label: "Functionality", chip: "bg-violet-500/15 text-violet-300" },
  { key: "data", label: "Data", chip: "bg-amber-500/15 text-amber-300" },
  { key: "docs", label: "Docs", chip: "bg-zinc-500/20 text-zinc-300" },
] as const;

export const CAT_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

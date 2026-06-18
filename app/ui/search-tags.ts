import type { SearchScope, SearchKind } from "@/lib/search";

// One source of truth for search's chip colors — read by BOTH the result badge
// (per kind) and the Filter dropdown (per scope). Type-only imports from
// lib/search are erased at build, so this stays client-safe (no node:fs bundled).
// One accent per corpus so a mixed result list reads at a glance.
export const KIND_TAG: Record<SearchKind, string> = {
  transcript: "bg-emerald-500/15 text-emerald-300",
  session: "bg-emerald-500/15 text-emerald-300",
  sdk: "bg-teal-500/15 text-teal-300",
  file: "bg-sky-500/15 text-sky-300",
  component: "bg-cyan-500/15 text-cyan-300",
  commit: "bg-orange-500/15 text-orange-300",
  todo: "bg-yellow-500/15 text-yellow-300",
  project: "bg-fuchsia-500/15 text-fuchsia-300",
  memory: "bg-violet-500/15 text-violet-300",
  note: "bg-blue-500/15 text-blue-300",
  script: "bg-amber-500/15 text-amber-300",
  skill: "bg-rose-500/15 text-rose-300",
};

// The Filter menu, in display order: every scope with its label + chip color.
// "all" is the neutral reset; the rest borrow their kind's accent so the menu
// chip matches the result badge it filters to.
export const SCOPE_TAGS: { value: SearchScope; label: string; chip: string }[] = [
  { value: "all", label: "All", chip: "bg-zinc-800/60 text-zinc-300" },
  { value: "sessions", label: "Sessions", chip: KIND_TAG.session },
  { value: "transcripts", label: "Transcripts", chip: KIND_TAG.transcript },
  { value: "sdk", label: "SDK", chip: KIND_TAG.sdk },
  { value: "files", label: "Files", chip: KIND_TAG.file },
  { value: "components", label: "Components", chip: KIND_TAG.component },
  { value: "commits", label: "Commits", chip: KIND_TAG.commit },
  { value: "todos", label: "Todos", chip: KIND_TAG.todo },
  { value: "projects", label: "Projects", chip: KIND_TAG.project },
  { value: "notes", label: "Notes", chip: KIND_TAG.note },
  { value: "memory", label: "Memory", chip: KIND_TAG.memory },
  { value: "scripts", label: "Scripts", chip: KIND_TAG.script },
  { value: "skills", label: "Skills", chip: KIND_TAG.skill },
];

// The Filter button face: "Filter" at rest (scope=all), else the active label.
export function scopeLabel(scope: SearchScope): string {
  if (scope === "all") return "Filter";
  return SCOPE_TAGS.find((s) => s.value === scope)?.label ?? "Filter";
}

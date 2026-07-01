"use client";

// lucide "network" — a hub with three connected nodes.
function NetworkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}

// The "Agent Teams" nav item — sits in the top group with New Session / Projects /
// Files / Fleet. Toggles the reveal of the live teams' LEAD sessions in the Recents
// list below (rendered there so they're full session rows with the shared kebab).
export default function AgentTeamsItem({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Agent Teams — show/hide live teams"
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-800 hover:text-zinc-100 ${
        open ? "text-zinc-100" : "text-zinc-400"
      }`}
    >
      <NetworkIcon />
      Agent Teams
    </button>
  );
}

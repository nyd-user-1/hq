"use client";

// The ONE panel-group "‹ ›" pair — steps the active member one back / forward
// (wrapping), swapping the container in place. Generic over the group: the container
// passes its members + onSelect. Replaced the per-group activity/console/tools
// nav-chips.
type Member = { key: string; title: string };

const CHIP =
  "boundary-flash-chip flex cursor-pointer items-center bg-zinc-800 px-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:text-zinc-200";

export default function GroupNavChips({
  active,
  members,
  onSelect,
}: {
  active: string;
  members: Member[];
  onSelect: (k: string) => void;
}) {
  const n = members.length;
  const idx = Math.max(0, members.findIndex((m) => m.key === active));
  const step = (delta: number) => onSelect(members[(idx + delta + n) % n].key);

  return (
    <div className="flex items-stretch gap-1 self-stretch">
      <button type="button" onClick={() => step(-1)} aria-label="previous panel" title="previous panel" className={CHIP}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <button type="button" onClick={() => step(1)} aria-label="next panel" title="next panel" className={CHIP}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

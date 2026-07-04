import { Section, StackedHead, SpinRing } from "./primitives";
import type { Spec } from "./spec-drawer";

const SPECS: Spec[] = [
  {
    n: "1.1",
    title: "The reader",
    desc: <>Turns, tool steps, and live working status parsed straight off the transcripts Claude Code already writes to <span className="font-mono text-zinc-300">~/.claude/projects</span>. No agent instrumentation, no SDK hooks.</>,
    file: "lib/transcript.ts",
  },
  {
    n: "1.2",
    title: "The border is the status",
    desc: <>Turn-state colors on the pane&apos;s own boundary — active <span className="font-mono text-blue-400">#2563eb</span>, thinking <span className="font-mono text-orange-400">#f97316</span>, done <span className="font-mono text-green-400">#22c55e</span> — with a traveling conic pulse while the model is writing.</>,
    file: "terminal.tsx",
  },
  {
    n: "1.3",
    title: "The wall",
    desc: <>Up to four controlled terminals side by side, each pinned to a live session. Agent-team teammates ride in as panes too, resolved to their real transcripts.</>,
    file: "?wall",
  },
  {
    n: "1.4",
    title: "Costs nothing at rest",
    desc: <>A 1s poll while a session is working; idle sessions are just files. There are no watchers to babysit.</>,
  },
];

// OBSERVE — hq's signature "money shot": the state-color system shown as a legend.
// Four panes, one per turn-state, so the value reads instantly — the border IS the
// status (blue focused · orange thinking · green done · red interrupted). Each pane
// carries a faint state-colored fill and lights up its own traveling ring on hover.
const STATES: { border: string; chip: string; glow: string; bg: string; label: string; title: string; cap: string }[] = [
  { border: "#2563eb", chip: "#2563eb", glow: "#60a5fa", bg: "rgba(37,99,235,0.06)", label: "FOCUSED", title: "Active", cap: "blue · your active pane" },
  { border: "#f97316", chip: "#ea580c", glow: "#fb923c", bg: "rgba(249,115,22,0.06)", label: "THINKING", title: "Working", cap: "ring travels · caret blinks" },
  { border: "#22c55e", chip: "#16a34a", glow: "#4ade80", bg: "rgba(34,197,94,0.06)", label: "DONE", title: "Complete", cap: "green · fades to grey" },
  { border: "#ef4444", chip: "#dc2626", glow: "#f87171", bg: "rgba(239,68,68,0.06)", label: "INTERRUPTED", title: "Interrupted", cap: "red · waiting on you" },
];

export default function Observe() {
  return (
    <Section id="observe">
      <StackedHead
        n="1.0"
        name="Observe"
        specs={SPECS}
        title="Reliable signal."
        desc={
          <>
            Run four terminals at once and glance to know. Blue is focused, orange is thinking,
            green just shipped, red stopped — the pane&apos;s own border carries the state, no dashboard to read.
          </>
        }
      />
      <div className="mt-14 grid grid-cols-2 gap-6 lg:grid-cols-4">
        {STATES.map((s, i) => (
          <div
            key={s.label}
            className="group relative flex flex-col rounded-lg border border-dashed p-4 pt-6 font-mono"
            style={{ borderColor: s.border, background: s.bg, minHeight: 500 }}
          >
            <span
              className="absolute -top-2.5 left-4 z-20 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-white"
              style={{ background: s.chip }}
            >
              <span className="size-1.5 rounded-full bg-white/90" />
              terminal-{i + 1}
            </span>
            {/* every pane lights its own state-color ring on hover — nothing travels at rest */}
            <SpinRing
              from={s.glow}
              to={s.glow}
              dur="2s"
              radius="9px"
              className="opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
            <span className="text-[11px] uppercase tracking-widest" style={{ color: s.border }}>
              {s.label}
            </span>
            <div className="mt-auto">
              <div className="font-sans text-2xl font-semibold text-zinc-50">{s.title}</div>
              <div className="mt-1.5 text-[13px] text-zinc-500">{s.cap}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

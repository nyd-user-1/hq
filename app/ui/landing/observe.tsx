import { Section, StackedHead, SpinRing } from "./primitives";

// OBSERVE — hq's signature "money shot": the state-color system shown as a legend.
// Four panes, one per turn-state, so the value reads instantly — the border IS the
// status (blue focused · orange thinking · green done · red interrupted).
const STATES: { border: string; chip: string; label: string; title: string; cap: string; ring?: [string, string] }[] = [
  { border: "#2563eb", chip: "#2563eb", label: "FOCUSED", title: "Active", cap: "blue · your active pane" },
  { border: "#f97316", chip: "#ea580c", label: "THINKING", title: "Working", cap: "ring travels · caret blinks", ring: ["#fbbf24", "#fb923c"] },
  { border: "#22c55e", chip: "#16a34a", label: "DONE", title: "Complete", cap: "green · fades to grey" },
  { border: "#ef4444", chip: "#dc2626", label: "INTERRUPTED", title: "Interrupted", cap: "red · waiting on you" },
];

export default function Observe() {
  return (
    <Section id="observe">
      <StackedHead
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
            style={{ borderColor: s.border, background: "#09090b", minHeight: 500 }}
          >
            <span
              className="absolute -top-2.5 left-4 z-20 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-white"
              style={{ background: s.chip }}
            >
              <span className="size-1.5 rounded-full bg-white/90" />
              terminal-{i + 1}
            </span>
            {/* The Working pane always travels its ring; the others light up their own
                state-color ring on hover so every pane animates under the cursor. */}
            {s.ring ? (
              <SpinRing from={s.ring[0]} to={s.ring[1]} dur="2.2s" radius="9px" />
            ) : (
              <SpinRing
                from={s.border}
                to={s.border}
                dur="2.2s"
                radius="9px"
                className="opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
            )}
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

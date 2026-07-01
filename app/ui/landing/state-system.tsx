import { Section, FileChip, SpinRing } from "./primitives";

// THE signature. Tall portrait cards, content bottom-anchored so the big empty space
// up top reads as calm surface waiting for a status. The dashed border IS the card —
// its color is the state — and a gradient arc travels the border to say "live". This
// is where the page spends its boldness; everything else stays quiet.
const STATES = [
  { chip: "terminal", chipBg: "#2563eb", border: "#2563eb", label: "IS-ACTIVE", labelColor: "#60a5fa", from: "#93c5fd", to: "#2563eb", dur: "2.4s", title: "Focused", body: "The one you're driving. Calm blue." },
  { chip: "thinking", chipBg: "#ea580c", border: "#f97316", label: "IS-THINKING", labelColor: "#fb923c", from: "#fbbf24", to: "#fb923c", dur: "1.6s", title: "Working", body: "Live work. The border pulses." },
  { chip: "done", chipBg: "#16a34a", border: "#22c55e", label: "IS-DONE", labelColor: "#4ade80", from: "#86efac", to: "#22c55e", dur: "2.4s", title: "Finished", body: "Shipped. Flashes green, done." },
  { chip: "stopped", chipBg: "#dc2626", border: "#ef4444", label: "IS-INTERRUPTED", labelColor: "#f87171", from: "#fca5a5", to: "#ef4444", dur: "2.4s", title: "Stopped", body: "Halted. Red, on sight." },
];

export default function StateSystem() {
  return (
    <Section id="interface">
      <FileChip>app/ui/terminal.tsx</FileChip>
      <h2 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-zinc-100 sm:text-5xl">
        Every terminal reports in.
      </h2>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-400">
        Glance and know. <span className="text-zinc-100">The border is the status.</span> Blue runs, orange thinks,
        green ships, red stops.
      </p>
      <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STATES.map((s) => (
          <div
            key={s.label}
            className="relative flex min-h-[280px] flex-col justify-end rounded-xl border-2 border-dashed p-7 sm:min-h-[400px] lg:min-h-[460px]"
            style={{ borderColor: s.border }}
          >
            <span
              className="absolute -top-3.5 left-6 z-[2] inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-sm text-white"
              style={{ background: s.chipBg }}
            >
              <span className="size-1.5 rounded-full bg-white" />
              {s.chip}
            </span>
            <SpinRing from={s.from} to={s.to} dur={s.dur} radius="13px" />
            <div className="font-mono text-sm tracking-wide" style={{ color: s.labelColor }}>
              {s.label}
            </div>
            <div className="mt-2 text-[26px] font-semibold leading-tight text-zinc-100">{s.title}</div>
            <p className="mt-2.5 text-[15px] leading-snug text-zinc-400">{s.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

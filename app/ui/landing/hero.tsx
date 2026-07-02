import FleetShot from "./fleet-shot";

// Section 1 — Linear's hero, faithfully: one giant headline, a description row
// with the "New · …" feature link at its right, then the product IS the page —
// the real app in Linear's frame chrome. Every chrome value here is lifted from
// linear.app's shipped CSS (Hero.css/theme tokens), not re-derived: frame
// #090a0b radius-12 p-8px over #101112 + 1px #ffffff14; view #121314 radius-7
// ring 0 0 0 2px #0000001a; top-left glow radial #ffffff0a; the lit gradient
// floor (180deg #08090a 10% → #d0d6e0) with its bottom radial damp; text
// #f7f8f8/#8a8f98; Inter-style variable weights 510/590. The board inside is
// the REAL fleet Analytics view (server-computed, live data, real components) —
// it scrolls, deliberately.
export default function Hero() {
  return (
    <section id="top" className="overflow-hidden px-5 sm:px-8">
      <div className="mx-auto max-w-6xl pt-20 sm:pt-28">
        <h1
          className="max-w-4xl text-4xl leading-[1.06] tracking-[-0.022em] sm:text-[48px]"
          style={{ fontWeight: 590, color: "#f7f8f8" }}
        >
          Local Artificial Intelligence Management
          <span
            aria-hidden
            className="ml-3 inline-block h-[0.72em] w-[0.38em] translate-y-[0.04em] bg-green-500"
            style={{ animation: "hq-cursor 1.1s steps(1) infinite" }}
          />
        </h1>
        <div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-baseline">
          <p className="max-w-xl text-[17px] leading-relaxed" style={{ color: "#8a8f98" }}>
            Every session writes to disk. hq reads it back live, prices every turn, and types
            straight into the running terminal.
          </p>
          <a href="#observe" className="group flex shrink-0 items-baseline gap-3 text-[15px]">
            <span style={{ color: "#f7f8f8", fontWeight: 510 }}>New</span>
            <span className="transition-colors group-hover:text-zinc-300" style={{ color: "#8a8f98" }}>
              Agent Teams{" "}
              <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </a>
        </div>
      </div>

      {/* The frame — Linear's hero app-shot chrome around the real fleet board.
          (Linear's lit gradient floor was tried and cut — the dashboard reads
          better floating on the pure marketing black.) */}
      <div className="relative mx-auto mt-[52px] w-full max-w-[1320px] pb-14">
        <div
          className="relative rounded-xl p-2"
          style={{ background: "#090a0b", boxShadow: "0px 7px 32px #00000059" }}
        >
          <div
            aria-hidden
            className="absolute inset-0 rounded-xl"
            style={{ background: "#101112", border: "1px solid #ffffff14" }}
          />
          {/* the view — the app surface itself */}
          <div
            className="relative overflow-hidden rounded-[7px]"
            style={{
              background: "#121314",
              border: "1px solid #ffffff14",
              boxShadow: "0 0 0 2px #0000001a",
              height: 640,
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "radial-gradient(50% 50%, #ffffff0a 0%, transparent 90%)" }}
            />
            <div
              className="relative flex items-center gap-2.5 border-b px-4 py-2.5 font-mono text-[11px]"
              style={{ borderColor: "#ffffff0d" }}
            >
              <span className="size-2 rounded-full bg-green-500" />
              <span style={{ color: "#d0d6e0" }}>hq</span>
              <span style={{ color: "#62666d" }}>·</span>
              <span style={{ color: "#8a8f98" }}>@fleet</span>
              <span className="ml-auto" style={{ color: "#62666d" }}>
                Analytics · live
              </span>
            </div>
            {/* the real board — sized to fill the view exactly, no scroll */}
            <div className="h-[calc(100%-37px)] overflow-hidden">
              <FleetShot />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

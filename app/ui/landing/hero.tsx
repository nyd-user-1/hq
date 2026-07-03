import HeroVideo from "./hero-video";

// Section 1 — Linear's hero, faithfully: one giant headline, a description row
// with the "New · …" feature link at its right, then the product IS the page —
// hq in Linear's frame chrome. Every chrome value here is lifted from linear.app's
// shipped CSS (Hero.css/theme tokens), not re-derived: frame #090a0b radius-12
// p-8px over #101112 + 1px #ffffff14; view #121314 radius-7 ring 0 0 0 2px
// #0000001a; text #f7f8f8/#8a8f98; Inter-style variable weights 510/590. The view
// holds a silent looping screen-recording of hq (16:9, so the frame is aspect-video
// and the clip fills it with no crop).
export default function Hero() {
  return (
    <section id="top" className="overflow-hidden px-5 sm:px-8">
      <div className="mx-auto max-w-6xl pt-20 sm:pt-28">
        <h1
          className="max-w-4xl text-4xl leading-[1.06] tracking-[-0.022em] sm:text-[48px]"
          style={{ fontWeight: 590, color: "#f7f8f8" }}
        >
          Local first AI Management for Humans
        </h1>
        <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <p className="max-w-xl text-[14px] leading-relaxed" style={{ color: "#8a8f98" }}>
            Purpose-built for CLI development in the AI era.
          </p>
          <a
            href="#observe"
            className="group flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[15px] transition-colors hover:bg-white/[0.08]"
          >
            <span style={{ color: "#f7f8f8", fontWeight: 510 }}>New</span>
            <span className="transition-colors group-hover:text-zinc-300" style={{ color: "#8a8f98" }}>
              Agent Teams
            </span>
          </a>
        </div>
      </div>

      {/* The frame — Linear's hero app-shot chrome around the hq video.
          (Linear's lit gradient floor was tried and cut — it reads better
          floating on the pure marketing black.) */}
      <div className="relative mx-auto mt-[52px] w-full max-w-6xl pb-14">
        <div
          className="relative rounded-xl p-2"
          style={{ background: "#090a0b", boxShadow: "0px 7px 32px #00000059" }}
        >
          <div
            aria-hidden
            className="absolute inset-0 rounded-xl"
            style={{ background: "#101112", border: "1px solid #ffffff14" }}
          />
          {/* the view — the app surface, holding the hq screen-recording. 16:9 so
              the 1280×720 clip fills it with no crop. */}
          <div
            className="relative aspect-video overflow-hidden rounded-[7px]"
            style={{
              background: "#121314",
              border: "1px solid #ffffff14",
              boxShadow: "0 0 0 2px #0000001a",
            }}
          >
            <HeroVideo />
          </div>
        </div>
      </div>
    </section>
  );
}

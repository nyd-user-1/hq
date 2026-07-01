import type { CSSProperties, ReactNode } from "react";
import SpecDrawer, { type Spec } from "./spec-drawer";

// Shared building blocks for the "/" landing (app/ui/landing/*). The whole page is
// rendered in hq's own visual vocabulary — dashed boundary boxes, file-path chips,
// Geist Mono — used as ACCENTS threaded through a cohesive web page, never as slide
// frames wrapping every section.

// The traveling conic-gradient that turns a card border into a live status light —
// hq's signature moment. Sits behind a rounded/dashed parent (position it absolute).
// Freezes under prefers-reduced-motion (globals.css targets [data-hq-spin]).
export function SpinRing({
  from,
  to,
  dur,
  radius = "14px",
}: {
  from: string;
  to: string;
  dur: string;
  radius?: string;
}) {
  const style: CSSProperties = {
    position: "absolute",
    inset: "-2px",
    borderRadius: radius,
    padding: "2px",
    background: `conic-gradient(from var(--hq-spin), transparent 0deg, ${from} 40deg, ${to} 60deg, transparent 100deg, transparent 360deg)`,
    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
    animation: `hq-border-spin ${dur} linear infinite`,
    pointerEvents: "none",
  };
  return <div data-hq-spin aria-hidden style={style} />;
}

// The section eyebrow — a soft file-path chip. Each section names the real hq module
// it's about; the mono tag is the through-line that keeps the page unmistakably hq.
export function FileChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-blue-500/10 px-2.5 py-1 font-mono text-xs text-blue-300 ring-1 ring-inset ring-blue-500/25">
      {children}
    </span>
  );
}

// Consistent section rhythm: one max-width, one vertical cadence, offset for the
// sticky nav so anchor jumps don't hide the heading under it.
export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 px-5 sm:px-8 ${className}`}>
      <div className="mx-auto max-w-6xl py-16 sm:py-24">{children}</div>
    </section>
  );
}

// The live "reading" indicator — a green dot with an expanding ping.
export function Ping({ color = "#34d399" }: { color?: string }) {
  return (
    <span className="relative inline-flex size-2.5">
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: color, animation: "hq-ping 1.6s cubic-bezier(0,0,0.2,1) infinite" }}
      />
      <span className="relative size-2.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

// The landing's structural spine, borrowed from Linear: a big two-tone headline on
// the left, a short description + a numbered "N — NAME" index on the right. The index
// is a real hq file path (the module the section is about), keeping it unmistakably
// hq rather than a generic marketing counter. Pass `specs` and the index line becomes
// the TECH SPECS drawer trigger (Linear's numbered sub-spec drill-down).
export function SectionHead({
  n,
  name,
  title,
  desc,
  specs,
}: {
  n: string;
  name: string;
  title: ReactNode;
  desc: ReactNode;
  specs?: Spec[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
      <h2 className="max-w-2xl text-4xl font-semibold leading-[1.02] tracking-[-0.02em] text-zinc-50 sm:text-[52px]">
        {title}
      </h2>
      <div className="lg:pt-2">
        <p className="max-w-md text-lg leading-relaxed text-zinc-400">{desc}</p>
        {specs ? (
          <SpecDrawer n={n} name={name} specs={specs} />
        ) : (
          <div className="mt-6 inline-flex items-center gap-2.5 font-mono text-[13px] text-zinc-500">
            <span className="text-zinc-600">{n}</span>
            <span className="text-zinc-300">{name}</span>
            <span className="text-blue-400">→</span>
          </div>
        )}
      </div>
    </div>
  );
}

// A product-shot frame — the hq dashed boundary with a file-path chip, so every
// screenshot sits inside hq's own visual identity (Linear frames its shots in a plain
// dark card; hq's frame IS the boundary). `tone` colors the border by state.
export function Shot({
  chip,
  tone = "#27272a",
  chipBg = "#27272a",
  children,
  className = "",
}: {
  chip?: string;
  tone?: string;
  chipBg?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-xl border border-dashed p-3 pt-5 sm:p-4 sm:pt-5 ${className}`}
      style={{ borderColor: tone, background: "#09090b" }}
    >
      {chip && (
        <span
          className="absolute -top-2.5 left-5 z-10 inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[11px] text-white"
          style={{ background: chipBg }}
        >
          <span className="size-1.5 rounded-full bg-white/90" />
          {chip}
        </span>
      )}
      {children}
    </div>
  );
}

import type { CSSProperties, ReactNode } from "react";

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

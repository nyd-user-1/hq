"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

// TECH SPECS — Linear's signature drill-down, in hq's vocabulary. Each section's
// "N.0 NAME →" index line doubles as the trigger; the panel flies over the page
// from the right. Chrome values are lifted verbatim from linear.app's shipped
// CSS: panel #0f1011 (--color-bg-panel) with an inset 1px #23252a ring
// (--color-border-primary), --shadow-high 0 7px 32px #00000059, the top-left
// radial glow, mono uppercase TECH SPECS label, #f7f8f8/#8a8f98/#62666d text.
// Content scrolls (deliberately); Esc + backdrop dismiss; enter-only animation.

export type Spec = { n: string; title: string; desc: ReactNode; file?: string };

export default function SpecDrawer({
  n,
  name,
  specs,
  children,
  triggerClassName = "",
}: {
  n: string;
  name: string;
  specs: Spec[];
  children?: ReactNode; // when given, the children ARE the trigger (e.g. a product-shot card)
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {children ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${name} tech specs`}
          className={triggerClassName}
        >
          {children}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[13px] transition-colors hover:bg-white/[0.08]"
        >
          <span className="relative z-[1] text-zinc-500">{n}</span>
          <span className="relative z-[1] text-zinc-200">{name}</span>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-[160%] bg-gradient-to-r from-transparent via-white/30 to-transparent motion-safe:group-hover:animate-[hq-shimmer_1.2s_ease-out_infinite]"
          />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${name} tech specs`}>
          <div
            data-hq-drawer
            className="absolute inset-0"
            style={{ background: "rgba(1,1,2,0.7)", animation: "hq-fade-in 0.2s ease-out" }}
            onClick={() => setOpen(false)}
          />
          <aside
            data-hq-drawer
            className="absolute bottom-3 right-3 top-3 flex w-[min(560px,94vw)] flex-col overflow-hidden rounded-xl"
            style={{
              background: "#0f1011",
              boxShadow: "inset 0 0 0 1px #23252a, 0px 7px 32px #00000059",
              animation: "hq-drawer-in 0.25s ease-out",
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "radial-gradient(circle, #ffffff14 0%, transparent 50%)", mixBlendMode: "lighten" }}
            />
            <div className="relative flex items-center px-6 py-5">
              <span
                className="font-mono text-[12px] uppercase"
                style={{ color: "#62666d", letterSpacing: "0.14em" }}
              >
                Tech specs
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ml-auto rounded p-1 transition-colors hover:bg-white/[0.06]"
                style={{ color: "#8a8f98" }}
              >
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="hq-scroll relative min-h-0 flex-1 overflow-y-auto px-6 pb-10">
              <div className="pt-4 font-mono text-[15px]" style={{ color: "#8a8f98" }}>
                {n}
              </div>
              <h2
                className="mt-3 text-[40px] leading-[1.05] tracking-[-0.02em]"
                style={{ color: "#f7f8f8", fontWeight: 590 }}
              >
                {name}
              </h2>
              <div className="mt-6">
                {specs.map((s) => (
                  <div key={s.n} className="border-t py-6 first:border-t-0" style={{ borderColor: "#23252a" }}>
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-[13px]" style={{ color: "#8a8f98" }}>
                        {s.n}
                      </span>
                      <h3 className="text-[17px]" style={{ color: "#f7f8f8", fontWeight: 510 }}>
                        {s.title}
                      </h3>
                    </div>
                    <p className="mt-2.5 text-[15px] leading-relaxed" style={{ color: "#8a8f98" }}>
                      {s.desc}
                    </p>
                    {s.file && (
                      <span
                        className="mt-3.5 inline-flex items-center rounded px-2 py-1 font-mono text-[11px]"
                        style={{ color: "#8a8f98", border: "1px solid #ffffff14", background: "#ffffff05" }}
                      >
                        {s.file}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

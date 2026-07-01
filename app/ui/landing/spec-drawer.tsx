"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

// TECH SPECS — Linear's signature drill-down, in hq's vocabulary. Each section's
// "N.0 NAME →" index line doubles as the trigger; the drawer slides in from the
// right and lists numbered N.1/N.2… sub-specs, each anchored to the real module it
// describes. Enter-only animation (unmounts on close), Esc + backdrop dismiss.

export type Spec = { n: string; title: string; desc: ReactNode; file?: string };

export default function SpecDrawer({
  n,
  name,
  specs,
}: {
  n: string;
  name: string;
  specs: Spec[];
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group mt-6 inline-flex items-center gap-2.5 font-mono text-[13px] text-zinc-500"
      >
        <span className="text-zinc-600">{n}</span>
        <span className="text-zinc-300">{name}</span>
        <span className="text-blue-400 transition-transform group-hover:translate-x-0.5">→</span>
        <span className="text-zinc-600 transition-colors group-hover:text-zinc-400">tech specs</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${name} tech specs`}>
          <div
            data-hq-drawer
            className="absolute inset-0 bg-black/60"
            style={{ animation: "hq-fade-in 0.2s ease-out" }}
            onClick={() => setOpen(false)}
          />
          <aside
            data-hq-drawer
            className="absolute right-0 top-0 flex h-full w-[min(460px,92vw)] flex-col border-l border-zinc-800 bg-zinc-950"
            style={{ animation: "hq-drawer-in 0.25s ease-out" }}
          >
            <div className="flex items-center gap-3 border-b border-zinc-900 px-6 py-4">
              <span className="font-mono text-[11px] tracking-[0.14em] text-zinc-600">TECH SPECS</span>
              <span className="font-mono text-[13px]">
                <span className="text-zinc-600">{n}</span> <span className="text-zinc-300">{name}</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 pb-8">
              {specs.map((s) => (
                <div key={s.n} className="border-b border-zinc-900 py-5 last:border-b-0">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[13px] text-blue-400">{s.n}</span>
                    <h3 className="text-[15px] font-medium text-zinc-100">{s.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.desc}</p>
                  {s.file && (
                    <span className="mt-3 inline-flex items-center rounded-md bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-500 ring-1 ring-inset ring-zinc-800">
                      {s.file}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

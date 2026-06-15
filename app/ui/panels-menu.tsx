"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PANELS } from "@/app/ui/sidebar-nav";
import { withPins } from "@/app/ui/keep-pins";
import ButtonChipIcon from "@/app/ui/button-chip-icon";

// The "panels" dropdown, restyled as a boundary chip so it sits on the terminal
// boundary line (just after the terminal.tsx path chip, before the search icon).
// Not click-to-copy — a ▾ marks it as a menu. The menu echoes the boundary
// aesthetic: a dashed border + an info-circle chip on its top-right corner (same
// pattern as the app panel's ✕).
export default function PanelsMenu() {
  const params = useSearchParams();
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  // Native <details> doesn't close on an outside click — wire that up.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);
  return (
    <details ref={ref} className="relative shrink-0">
      <summary
        title="open a panel"
        // matches the terminal.tsx boundary chip's color (zinc-400 / hover-200)
        className="flex cursor-pointer list-none items-center gap-1 bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors marker:content-none [&::-webkit-details-marker]:hidden hover:text-zinc-200"
      >
        panels <span className="text-[7px] tracking-normal">▼</span>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-3 flex w-40 flex-col gap-0.5 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-1.5 shadow-xl">
        {/* info-circle chip on the top-right corner — same pattern as the app
            panel's ✕, straddling the dashed top border */}
        <div className="absolute -top-2.5 right-2 z-10">
          <ButtonChipIcon
            onClick={() => {}}
            label="About panels"
            title="about panels"
            icon={
              // lucide Info
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            }
          />
        </div>
        {PANELS.map((p) => {
          const active = p.routes.includes(pathname ?? "");
          return (
            <Link
              key={p.href}
              href={withPins(p.href, params.toString())}
              scroll={false}
              onClick={close}
              className={`rounded px-2 py-1 font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
                active ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.title}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

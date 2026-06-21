"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PANELS } from "@/app/ui/panel-nav";
import { withPins } from "@/app/ui/keep-pins";
import ButtonChipIcon from "@/app/ui/button-chip-icon";
import { usePlanner } from "@/app/ui/planner-state";
import { useApi } from "@/app/ui/api-state";
import { useTextEditor } from "@/app/ui/text-editor-state";

// The "panels" dropdown. Its trigger is the layout-grid icon (the planner chip's
// former icon), styled like the header's bare search button — it now lives IN the
// terminal header, just left of the per-session search. The menu keeps its
// boundary aesthetic: a dashed border + an info-circle chip on its top-right.
export default function PanelMenu() {
  const params = useSearchParams();
  const pathname = usePathname();
  const { open: plannerOpen, toggle: togglePlanner } = usePlanner();
  const { open: apiOpen, toggle: toggleApi } = useApi();
  const { open: textOpen, toggle: toggleText } = useTextEditor();
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
    <details
      ref={ref}
      className="relative shrink-0"
      // Navbar-style: open on hover, close when the pointer leaves — it's a nav menu.
      onMouseEnter={() => { if (ref.current) ref.current.open = true; }}
      onMouseLeave={() => { if (ref.current) ref.current.open = false; }}
    >
      <summary
        title="open a panel"
        // The layout-grid icon, styled like the header's bare search button.
        className="flex shrink-0 cursor-pointer list-none items-center rounded-md p-1.5 text-zinc-400 transition-colors marker:content-none [&::-webkit-details-marker]:hidden hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </summary>
      {/* pt-1.5 is a TRANSPARENT hover-bridge (a descendant of <details>, so the
          pointer can cross the gap from icon to menu without firing mouseleave). */}
      <div className="absolute left-0 top-full z-20 pt-1.5">
      <div className="relative flex w-40 flex-col gap-0.5 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-1.5 shadow-xl">
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
        {/* Planner — not a route panel; an independent toggle with its own panel
            root (can sit open alongside a route panel), so it's a button driven by
            client state, not a Link. Sits after Compose. */}
        <button
          onClick={() => {
            togglePlanner();
            close();
          }}
          className={`rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
            plannerOpen ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Planner
        </button>
        {/* API — like Planner, an independent client-state toggle with its own
            panel root; HQ's read of the CLI /usage screen (session/week meters,
            burn, spend), live-polled. Sits after Planner. */}
        <button
          onClick={() => {
            toggleApi();
            close();
          }}
          className={`rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
            apiOpen ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          API
        </button>
        {/* Text — like Planner, an independent client-state toggle (a full-screen
            capture modal, not a route panel), so it's a button. Sits last. */}
        <button
          onClick={() => {
            toggleText();
            close();
          }}
          className={`rounded px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-zinc-900 ${
            textOpen ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Text
        </button>
      </div>
      </div>
    </details>
  );
}

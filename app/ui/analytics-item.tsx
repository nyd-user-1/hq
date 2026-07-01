"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useKpis, RECOMMENDED_VIEWS, type SavedView } from "@/app/ui/kpi-state";

// Analytics nav item (formerly "Fleet") — the label opens the analytics dashboard
// in Terminal 1 (?session=@fleet); the chevron expands the recommended + saved
// board views, each of which applies the view (kpi-state) and opens the dashboard.
export default function AnalyticsItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const router = useRouter();
  const active = params.get("session") === "@fleet";
  const { views, applyView } = useKpis();
  const [expanded, setExpanded] = useState(false);

  // Label click: open @fleet, or drop to home if it's already the surface.
  const openSp = new URLSearchParams(params.toString());
  openSp.delete("center");
  openSp.delete("lead");
  if (active) openSp.delete("session");
  else openSp.set("session", "@fleet");
  const openHref = `${pathname}${openSp.toString() ? `?${openSp}` : ""}`;

  // A view row: apply the board (kpi-state) then make sure @fleet is showing.
  const openView = (v: SavedView) => {
    applyView(v);
    const sp = new URLSearchParams(params.toString());
    sp.delete("center");
    sp.delete("lead");
    sp.set("session", "@fleet");
    router.push(`${pathname}?${sp}`, { scroll: false });
  };

  return (
    <div className="flex flex-col">
      <div
        className={`flex items-center gap-1 rounded-md text-xs font-medium transition-colors ${
          active ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        }`}
      >
        <Link href={openHref} scroll={false} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">
          {/* lucide pie-chart */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
            <path d="M22 12A10 10 0 0 0 12 2v10z" />
          </svg>
          Analytics
        </Link>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse views" : "Expand views"}
          aria-expanded={expanded}
          className="shrink-0 rounded p-1 pr-2 opacity-70 transition-opacity hover:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="mt-0.5 ml-[1.125rem] flex flex-col border-l border-zinc-800 pl-1.5">
          <span className="px-2 pt-1 font-mono text-[9px] uppercase tracking-widest text-zinc-600">Recommended</span>
          {RECOMMENDED_VIEWS.map((v) => (
            <button
              key={v.name}
              onClick={() => openView(v)}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
            </button>
          ))}
          {views.length > 0 && (
            <>
              <span className="px-2 pt-1 font-mono text-[9px] uppercase tracking-widest text-zinc-600">Saved</span>
              {views.map((v) => (
                <button
                  key={v.name}
                  onClick={() => openView(v)}
                  className="flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

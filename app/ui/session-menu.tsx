"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Hover menu on the terminal header's session id: a search + auto-scroll dropdown
// over your PAST sessions, newest→oldest (same TodoMenu "Get Todo" drawer shape).
// Pick one to switch the terminal to it — keeps the pair pin, just swaps ?session.
// The id button itself (children) keeps its click-to-copy; the menu rides on hover.

type Sess = {
  id: string;
  project: string;
  title: string;
  customTitle: string;
  lastActive: number;
  active: boolean;
  live: boolean;
  branch: string;
};

function ago(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SessionMenu({ currentId, children }: { currentId: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Sess[] | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open on HOVER with a grace period on leave (cross to the menu), like the kebab.
  const enter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  // Fetch recents (already newest→oldest) each time it opens; keep the last list
  // across closes so a reopen shows it while it refetches.
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => live && setSessions(Array.isArray(d.sessions) ? d.sessions : []))
      .catch(() => live && setSessions([]));
    return () => {
      live = false;
    };
  }, [open]);

  // Focus the search + auto-scroll the current session into view on open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, sessions]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const switchTo = (id: string) => {
    if (id !== currentId) {
      const sp = new URLSearchParams(params.toString());
      sp.set("session", id); // keep ?pair etc., just swap the session
      router.push(`?${sp.toString()}`, { scroll: false });
    }
    close();
  };

  const q = query.trim().toLowerCase();
  const matches = (sessions ?? []).filter(
    (s) => !q || `${s.customTitle} ${s.title} ${s.project} ${s.branch} ${s.id}`.toLowerCase().includes(q),
  );

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center" onMouseEnter={enter} onMouseLeave={leave}>
      {children}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 flex max-h-[340px] w-72 flex-col overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-xl">
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-600" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={sessions ? `Search ${sessions.length} sessions…` : "Search sessions…"}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300">
                ✕
              </button>
            )}
          </div>

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
            {sessions === null ? (
              <p className="px-2.5 py-3 font-mono text-[10px] text-zinc-600">loading…</p>
            ) : matches.length === 0 ? (
              <p className="px-2.5 py-3 font-mono text-[10px] text-zinc-600">{q ? "no matches" : "no sessions"}</p>
            ) : (
              matches.map((s, i) => {
                const isCurrent = s.id === currentId;
                const dot = s.live ? "bg-green-400 animate-pulse" : s.active ? "bg-green-400" : "bg-zinc-600";
                return (
                  <button
                    key={s.id}
                    ref={isCurrent ? currentRef : undefined}
                    type="button"
                    onClick={() => switchTo(s.id)}
                    title={isCurrent ? "current session" : `switch to ${s.id.slice(0, 8)}`}
                    className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900 ${
                      i > 0 ? "border-t border-zinc-800/70" : ""
                    } ${isCurrent ? "bg-zinc-900/60" : ""}`}
                  >
                    <span className={`mt-1 size-1.5 shrink-0 rounded-full ${dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className={`min-w-0 flex-1 truncate text-[11px] ${isCurrent ? "text-zinc-100" : "text-zinc-300"}`}>
                          {s.customTitle || s.title}
                        </span>
                        {isCurrent && <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-green-500/80">current</span>}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
                        {[s.project, s.id.slice(0, 8), ago(s.lastActive)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

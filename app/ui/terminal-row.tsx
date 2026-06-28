"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import Terminal from "@/app/ui/terminal";

// Terminal 1 + the WALL. Terminal 1 (children) is ALWAYS the first child → never
// remounts. Up to THREE more panes come from `?wall=id2,id3,id4` (the session-item
// menu appends to it; 4 panes total, the point of diminishing returns). Each extra
// pane is a CONTROLLED <Terminal sessionId=…> — it drives its session directly with
// no URL coupling, so panes mount/unmount freely (the daemon owns the processes).
// Replaces the old PairColumn / single-?pair split with one N-up mechanism.
export default function TerminalRow({
  children,
  initialFocus = true,
}: {
  children: React.ReactNode;
  // Seeds the wall panes' focus mode from the same hq-focus cookie as Terminal 1.
  initialFocus?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* Terminal 1 — always rendered, always first → never remounts */}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {/* Wall panes 2–4 — Suspense keeps useSearchParams from breaking the static
          /_not-found prerender */}
      <Suspense fallback={null}>
        <WallPanes initialFocus={initialFocus} />
      </Suspense>
    </div>
  );
}

function WallPanes({ initialFocus }: { initialFocus: boolean }) {
  const params = useSearchParams();
  const pathname = usePathname() ?? "/";
  const session = params.get("session");
  const ids = (params.get("wall") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3); // 4 panes total (T1 + 3)
  if (ids.length === 0) return null;

  // close ONE pane = drop it from ?wall (keep T1's ?session + the other panes)
  const closeHref = (id: string) => {
    const rest = ids.filter((x) => x !== id);
    const sp = new URLSearchParams();
    if (session) sp.set("session", session);
    if (rest.length) sp.set("wall", rest.join(","));
    return sp.toString() ? `${pathname}?${sp}` : pathname;
  };

  return (
    <>
      {ids.map((id, i) => (
        <div key={id} className="relative flex min-w-0 flex-1 flex-col">
          <Boundary label={`terminal-${i + 2}`} copyText="app/ui/terminal.tsx">
            <Link
              href={closeHref(id)}
              scroll={false}
              title={`close terminal ${i + 2}`}
              aria-label={`close terminal ${i + 2}`}
              className="absolute -top-2.5 right-3 z-10 flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-zinc-400 transition-colors hover:text-zinc-100"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </Link>
            <Terminal sessionId={id} initialFocus={initialFocus} />
          </Boundary>
        </div>
      ))}
    </>
  );
}

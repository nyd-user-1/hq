"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import Terminal from "@/app/ui/terminal";
import TerminalChipMenu from "@/app/ui/terminal-chip-menu";
import PaneView from "@/app/ui/pane-view";
import { wallTokens, parseToken } from "@/app/ui/terminals";

// Terminal 1 + the WALL. Terminal 1 (children) is ALWAYS the first child → never
// remounts. Up to THREE more panes come from ?wall — a comma-list of TYPED tokens,
// each either a session id or a view ("@fleet"). So a wall pane is a viewport that
// can hold a live session OR a dashboard (Fleet/Files/Projects), switched from its
// own boundary-chip menu. Session panes are controlled <Terminal sessionId>; view
// panes render the view component. The daemon owns every session process, so panes
// mount/unmount freely.
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
  const toks = wallTokens(params);
  if (toks.length === 0) return null;

  // close ONE pane = drop its token by index (keep T1's ?session + the others)
  const closeHref = (i: number) => {
    const rest = toks.filter((_, idx) => idx !== i);
    const sp = new URLSearchParams();
    if (session) sp.set("session", session);
    if (rest.length) sp.set("wall", rest.join(","));
    return sp.toString() ? `${pathname}?${sp}` : pathname;
  };

  return (
    <>
      {toks.map((tok, i) => {
        const content = parseToken(tok);
        const slot = i + 2;
        const terminalKey = `t${slot}`;
        // Key by the token (not the index) so closing a sibling never remounts the
        // others — preserves each pane's live state, as the wall did before.
        return (
          <div key={tok} className="relative flex min-w-0 flex-1 flex-col">
            <Boundary
              label={`terminal-${slot}`}
              copyText="app/ui/terminal.tsx"
              lead={content ? <TerminalChipMenu target={{ kind: "wall", index: i }} /> : undefined}
            >
              <Link
                href={closeHref(i)}
                scroll={false}
                title={`close terminal ${slot}`}
                aria-label={`close terminal ${slot}`}
                className="absolute -top-2.5 right-3 z-10 flex shrink-0 items-center bg-zinc-800 px-1.5 py-0.5 text-zinc-400 transition-colors hover:text-zinc-100"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </Link>
              {content?.kind === "view" ? (
                <PaneView view={content.view} terminalKey={terminalKey} />
              ) : (
                <Terminal
                  sessionId={content?.kind === "session" ? content.sessionId : tok}
                  initialFocus={initialFocus}
                  terminalKey={terminalKey}
                />
              )}
            </Boundary>
          </div>
        );
      })}
    </>
  );
}

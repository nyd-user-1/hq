"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import Terminal from "@/app/ui/terminal";
import TerminalChipMenu from "@/app/ui/terminal-chip-menu";
import { useFocus } from "@/app/ui/focus-state";
import { wallTokens, parseToken, type WallView } from "@/app/ui/terminals";
import FleetView from "@/app/ui/fleet-view";
import FilesView from "@/app/ui/files-view";
import ProjectView from "@/app/ui/project-view";

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

// One view rendered as a pane's content (Fleet is a clean drop-in; Files/Projects
// render fine but still carry their ?center-overlay router wiring — see notes).
function ViewFor({ view }: { view: WallView }) {
  if (view === "fleet") return <FleetView />;
  if (view === "files") return <FilesView />;
  if (view === "projects") return <ProjectView />;
  return null; // "sessions" home isn't embeddable in a pane yet
}

// A view pane carries the same focus behavior as a session pane (Terminal does its
// own): a pointer-down makes it active, and it wears the blue .is-active border.
function ViewPane({ view, terminalKey }: { view: WallView; terminalKey: string }) {
  const { activeKey, setActive } = useFocus();
  const ref = useRef<HTMLDivElement>(null);
  const isActive = activeKey === terminalKey;
  useEffect(() => {
    const box = ref.current?.closest(".boundary-flash");
    if (!box) return;
    box.classList.toggle("is-active", isActive);
    return () => box.classList.remove("is-active");
  }, [isActive]);
  return (
    <div
      ref={ref}
      onPointerDownCapture={() => setActive(terminalKey)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ViewFor view={view} />
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
              trail={content ? <TerminalChipMenu index={i} current={content} /> : undefined}
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
                <ViewPane view={content.view} terminalKey={terminalKey} />
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

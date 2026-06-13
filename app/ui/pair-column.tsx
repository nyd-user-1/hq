"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Boundary from "@/app/ui/boundary";
import Terminal from "@/app/ui/terminal";

// Terminal 1 | Terminal 2. Permanent wrapper around the primary, always-mounted
// terminal: it is ALWAYS the first child here, so toggling pair only adds/removes
// the SECOND pane — Terminal 1 never unmounts. When ?pair=<id> is set, a ~50%
// second pane mounts a real, independent Terminal driven off ?pair (Terminal 1
// stays on ?session). To remove: drop this file, unwrap in shell.tsx, and delete
// the split affordance in sidebar-recents.tsx.
export default function PairColumn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* Terminal 1 — always rendered, always first → never remounts */}
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {/* Terminal 2 — reads ?pair; Suspense keeps useSearchParams from breaking
          the static /_not-found prerender */}
      <Suspense fallback={null}>
        <PairPane />
      </Suspense>
    </div>
  );
}

function PairPane() {
  const params = useSearchParams();
  const pair = params.get("pair");
  const session = params.get("session");
  const pathname = usePathname() ?? "/";
  if (!pair) return null;
  // closing terminal 2 = drop ?pair, keep terminal 1's ?session
  const closeHref = session ? `${pathname}?session=${session}` : pathname;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Boundary
        label="terminal.tsx · 2"
        trail={
          <Link
            href={closeHref}
            scroll={false}
            title="close terminal 2"
            aria-label="close terminal 2"
            className="rounded border border-zinc-800 px-1 font-mono text-[10px] leading-none text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            ✕
          </Link>
        }
      >
        <Terminal paramKey="pair" />
      </Boundary>
    </div>
  );
}

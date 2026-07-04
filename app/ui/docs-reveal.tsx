"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDocs } from "@/app/ui/docs-state";
import { useFocus } from "@/app/ui/focus-state";
import { wallTokens, MAX_TERMINALS } from "@/app/ui/terminals";

// Surfaces the @docs pane whenever a doc tab is opened from OUTSIDE the Docs
// view (a block's "Open in Doc", a reader's pencil). Watches DocsProvider's
// revealNonce; if no pane already holds @docs it places one — beside the live
// session when T1 holds one (the side-by-side promise: a wall slot), otherwise
// in T1 itself. Mounted once in shell.tsx behind Suspense (useSearchParams).
export default function DocsReveal() {
  const { revealNonce } = useDocs();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const { setActive } = useFocus();
  const seen = useRef(0);

  useEffect(() => {
    if (revealNonce === 0 || revealNonce === seen.current) return;
    seen.current = revealNonce;

    const session = params.get("session");
    const toks = wallTokens(params);

    // Already visible somewhere → just focus that pane.
    if (session === "@docs") {
      setActive("t1");
      return;
    }
    const onWall = toks.indexOf("@docs");
    if (onWall !== -1) {
      setActive(`t${onWall + 2}`);
      return;
    }

    const sp = new URLSearchParams(params.toString());
    const t1HasSession = !!session && !session.startsWith("@") && session !== "new";
    if (t1HasSession) {
      // Side-by-side: docs takes a wall slot next to the live terminal. At the
      // pane cap the LAST wall pane yields (T1 — the anchor — never does).
      const next =
        toks.length >= MAX_TERMINALS - 1
          ? [...toks.slice(0, MAX_TERMINALS - 2), "@docs"]
          : [...toks, "@docs"];
      sp.set("wall", next.join(","));
      setActive(`t${next.indexOf("@docs") + 2}`);
    } else {
      // Nothing live in T1 (home / another view) → docs fills Terminal 1.
      sp.set("session", "@docs");
      sp.delete("lead"); // a view isn't a team lead
      setActive("t1");
    }
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [revealNonce, params, pathname, router, setActive]);

  return null;
}

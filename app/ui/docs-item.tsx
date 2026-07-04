"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useDocs } from "@/app/ui/docs-state";
import { wallTokens } from "@/app/ui/terminals";

// Opening Docs into T1 evicts whatever ?session held (a live session, "new",
// another view). Remember that token so toggling Docs OFF restores your seat
// instead of dumping you on the root landing. sessionStorage (not state) so the
// restore survives a refresh, same as the docs tabs themselves.
const DISPLACED_KEY = "hq-docs-displaced";
const rememberDisplaced = (tok: string | null) => {
  try {
    if (tok) sessionStorage.setItem(DISPLACED_KEY, tok);
    else sessionStorage.removeItem(DISPLACED_KEY);
  } catch {
    /* storage blocked — toggle-off just falls back to home */
  }
};

// Docs nav item — the sidebar entry to the document editor, a Files sibling.
// Shows Docs IN Terminal 1 (the tab model: ?session=@docs → Terminal1Slot →
// PaneView), or lights up when @docs already sits on the wall. Clicking while
// active closes the pane wherever it is (tabs persist in DocsProvider — the
// pane is a viewport, closing it loses nothing) and restores the session Docs
// displaced from T1.
export default function DocsItem() {
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const { docsOpen } = useDocs();
  const toks = wallTokens(params);
  const ses = params.get("session");
  const inT1 = ses === "@docs";
  const onWall = toks.includes("@docs");
  const active = inT1 || onWall;

  // The displaced token, read after hydration (state, not a render-time storage
  // read, so server and client first paints match).
  const [restore, setRestore] = useState<string | null>(null);
  useEffect(() => {
    if (!inT1) return;
    try {
      setRestore(sessionStorage.getItem(DISPLACED_KEY));
    } catch {
      setRestore(null);
    }
  }, [inT1]);

  const sp = new URLSearchParams(params.toString());
  sp.delete("center"); // legacy overlay param — retired
  if (active) {
    // toggle off — drop @docs from whichever pane holds it; T1 gets back the
    // token Docs displaced (falls back to home when there wasn't one).
    if (inT1) {
      if (restore) sp.set("session", restore);
      else sp.delete("session");
    }
    const rest = toks.filter((t) => t !== "@docs");
    if (rest.length) sp.set("wall", rest.join(","));
    else sp.delete("wall");
  } else {
    sp.set("session", "@docs"); // Docs fills Terminal 1
    sp.delete("lead"); // a view isn't a team lead
  }
  const href = `${pathname}${sp.toString() ? `?${sp}` : ""}`;

  const onClick = () => {
    // record the eviction on open; consume the memo on close
    if (!active) rememberDisplaced(ses && ses !== "@docs" ? ses : null);
    else if (inT1) rememberDisplaced(null);
  };

  return (
    <Link
      href={href}
      onClick={onClick}
      scroll={false}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      }`}
    >
      {/* lucide file-pen — a page with a pen, the editor glyph */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
      </svg>
      Docs
      {/* open-tabs cue — a quiet dot when tabs are held in the provider */}
      {docsOpen && !active && (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-zinc-600" aria-hidden />
      )}
    </Link>
  );
}

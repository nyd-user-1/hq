"use client";

import { useSearchParams } from "next/navigation";
import Terminal from "@/app/ui/terminal";
import PaneView from "@/app/ui/pane-view";
import { parseToken } from "@/app/ui/terminals";

// Terminal 1's content chooser. T1 is the ANCHOR — its content rides ?session, the
// same typed-token scheme as the wall: a view token ("@fleet") renders the view in
// T1's column; anything else (a session id, "new", or empty/home) falls through to
// the always-there <Terminal>, byte-for-byte as before. So switching T1 to a view
// is a deliberate content change (the session <Terminal> unmounts), but ordinary
// session/panel navigation never crosses that boundary — T1 still never remounts.
export default function Terminal1Slot({ initialFocus }: { initialFocus: boolean }) {
  const ses = useSearchParams().get("session");
  const content = ses ? parseToken(ses) : null;
  if (content?.kind === "view") {
    return <PaneView view={content.view} terminalKey="t1" />;
  }
  return <Terminal initialFocus={initialFocus} terminalKey="t1" />;
}

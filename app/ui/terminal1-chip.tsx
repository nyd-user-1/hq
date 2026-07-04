"use client";

import { useSearchParams } from "next/navigation";
import BoundaryChip from "@/app/ui/boundary-chip";
import { parseToken, VIEW_FILES } from "@/app/ui/terminals";

// Terminal 1's LABEL chip. T1 is a pane, so its chip names the occupant: a view
// token (?session=@docs/@fleet/…) wears the view's own file — "docs" copying
// app/ui/docs.tsx — while a session (or home/new) keeps "terminal-1". Replaces
// the old two-chip reading ("terminal-1 · Docs"), which made a view look like a
// mode of the terminal instead of a peer. reorderSlot rides along either way so
// the chip stays the slot-1 drag handle.
export default function Terminal1Chip() {
  const ses = useSearchParams().get("session");
  const content = ses ? parseToken(ses) : null;
  const viewFile = content?.kind === "view" ? VIEW_FILES[content.view] : undefined;
  if (viewFile) {
    return (
      <BoundaryChip
        label={viewFile.split("/").pop()!}
        copyText={viewFile}
        reorderSlot={1}
      />
    );
  }
  return (
    <BoundaryChip label="terminal-1" copyText="app/ui/terminal.tsx" reorderSlot={1} />
  );
}

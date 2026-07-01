"use client";

import { useSearchParams } from "next/navigation";
import { parseToken } from "@/app/ui/terminals";
import { CHIP_CLASS } from "@/app/ui/boundary-chip";

// When Terminal 1 holds a VIEW (the tab model: ?session=@fleet/@files/@projects),
// show the view's name as a chip on the boundary line — between the "terminal-1"
// chip and the ▾ menu — so a view reads like a labelled browser tab. Renders
// nothing for an ordinary session.
const VIEW_NAMES: Record<string, string> = {
  fleet: "Analytics",
  files: "Files",
  projects: "Projects",
  sessions: "Sessions",
};

export default function Terminal1ViewChip() {
  const ses = useSearchParams().get("session");
  const content = ses ? parseToken(ses) : null;
  if (content?.kind !== "view") return null;
  return (
    <span className={`${CHIP_CLASS} !cursor-default`} title="the view filling Terminal 1">
      {VIEW_NAMES[content.view] ?? content.view}
    </span>
  );
}

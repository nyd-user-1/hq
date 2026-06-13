import { Suspense } from "react";
import Boundary from "@/app/ui/boundary";
import ArchiveBrowser from "@/app/ui/archive-browser";

export const dynamic = "force-dynamic";

// Session Archive: search + browse every Claude Code session ever.
export default function Archive() {
  return (
    <Boundary label="@panel/archive/page.tsx">
      <Suspense fallback={null}>
        <ArchiveBrowser />
      </Suspense>
    </Boundary>
  );
}

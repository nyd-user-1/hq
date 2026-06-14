import Boundary from "@/app/ui/boundary";
import ComposeTray from "@/app/ui/compose-tray";

export const dynamic = "force-dynamic";

// Compose: a tray you gather artifacts into, then "Send to terminal" drops the
// assembled refs into Terminal 1's message box. Standalone panel (no tabs), like
// /search. Foundation step — source cards become draggable in later sub-tasks.
export default function Compose() {
  return (
    <Boundary label="@panel/compose/page.tsx">
      <ComposeTray />
    </Boundary>
  );
}

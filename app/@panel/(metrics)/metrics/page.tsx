import Boundary from "@/app/ui/boundary";
import MetricsHub from "@/app/ui/metrics-hub";

export const dynamic = "force-dynamic";

// Metrics — the panel's landing hub. A drill-down index into Usage / Calls /
// Guardrails; each opens full-panel with a "‹ back" (drawn by the layout).
// Savings + Memory Audit still exist as routes (reachable via ⌘K), just not
// surfaced here.
export default function MetricsHubPage() {
  return (
    <Boundary topOnly bleedX label="@panel/(metrics)/metrics/page.tsx">
      <MetricsHub />
    </Boundary>
  );
}

import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import MetricsBackBar from "@/app/ui/metrics-back-bar";

export const dynamic = "force-dynamic";

// Metrics panel: a drill-down hub (/metrics) into Usage · Calls · Guardrails.
// The hub IS the nav; once you're in a section the back bar replaces it with a
// "‹ back". Savings + Memory Audit still live here as routes (reachable via ⌘K),
// just not surfaced in the hub.
export default function MetricsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(metrics)/layout.tsx">
      <MetricsBackBar />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

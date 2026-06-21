import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Metrics panel: Usage · Calls · Guardrails — each a tab, mirroring the
// Activity/Console panels. Savings + Memory Audit still exist as routes
// (reachable via ⌘K), just not surfaced as tabs here.
export default function MetricsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(metrics)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Usage", href: "/metrics", segment: "metrics" },
          { title: "Calls", href: "/calls", segment: "calls" },
          { title: "Guardrails", href: "/guardrails", segment: "guardrails" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

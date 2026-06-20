import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Metrics panel: Usage & Burn · Calls · Savings · Memory Audit — each a tab,
// mirroring the Activity/Console panels. Calls (the $/call Ledger) lives here
// with the other cost views. The sidebar nav groups collapsed into the
// terminal's "panels" dropdown, so these live as tabs under one panel.
export default function MetricsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(metrics)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Usage & Burn", href: "/metrics", segment: "metrics" },
          { title: "Calls", href: "/calls", segment: "calls" },
          { title: "Guardrails", href: "/guardrails", segment: "guardrails" },
          { title: "Savings", href: "/savings", segment: "savings" },
          { title: "Memory Audit", href: "/audit", segment: "audit" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

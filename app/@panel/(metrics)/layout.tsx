import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Metrics panel: Usage & Burn · Savings · Memory Audit — each a tab, mirroring
// the Activity/Console panels. The sidebar nav groups collapsed into the
// terminal's "panels" dropdown, so these three live as tabs under one panel
// instead of standalone sidebar items.
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
          { title: "Savings", href: "/savings", segment: "savings" },
          { title: "Memory Audit", href: "/audit", segment: "audit" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Activity panel: To Do · Components · Shipped tabs at the top (To Do first —
// the "panels" button lands here). Components = the HQ component registry;
// Shipped = the cross-project commit feed. Sessions + SDK live in Console; Calls
// (the $/call Ledger) in Metrics.
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(activity)/layout.tsx">
      <TabNav
        tabs={[
          { title: "To Do", href: "/todo", segment: "todo" },
          { title: "Components", href: "/components", segment: "components" },
          { title: "Shipped", href: "/shipped", segment: "shipped" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

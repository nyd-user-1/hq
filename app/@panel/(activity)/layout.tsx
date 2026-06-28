import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Activity panel: Projects · To Do · Components tabs at the top (Projects first —
// the "panels" button lands here). Projects = the per-project session grid (moved
// in from its own group); Components = the HQ component registry. Shipped retired —
// the cross-project commit feed is now the standalone Changelog panel (Activity ▾).
// Sessions + SDK live in Console; Calls (the $/call Ledger) in Metrics.
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(activity)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Projects", href: "/projects", segment: "projects" },
          { title: "To Do", href: "/todo", segment: "todo" },
          { title: "Components", href: "/components", segment: "components" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

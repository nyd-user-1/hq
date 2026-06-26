import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Console panel: Tree · Routines · Firehose. Skills + CMD migrated to their own
// standalone panels (skills-panel.tsx / commands-panel.tsx, opened from the
// Console menu); Sessions + SDK were removed earlier. Shipped lives in Activity.
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(console)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Tree", href: "/tree", segment: "tree" },
          { title: "Routines", href: "/routines", segment: "routines" },
          { title: "Firehose", href: "/firehose", segment: "firehose" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

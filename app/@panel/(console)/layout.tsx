import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Console panel: Skills · CMD · Routines · Firehose. Sessions + SDK were removed
// (the sidebar Recents owns session selection now; SDK runs are searchable via
// the Search panel). Shipped lives in the Activity panel.
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(console)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Skills", href: "/skills", segment: "skills" },
          { title: "CMD", href: "/cmd", segment: "cmd" },
          { title: "Routines", href: "/routines", segment: "routines" },
          { title: "Firehose", href: "/firehose", segment: "firehose" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

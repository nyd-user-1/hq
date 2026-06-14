import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Console panel: Shipped · Skills · CMD · Routines · Firehose.
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(console)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Shipped", href: "/shipped", segment: "shipped" },
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

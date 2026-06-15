import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Console panel: Sessions · SDK · Skills · CMD · Routines · Firehose. Sessions
// also lives in the sidebar Recents; SDK = Agent SDK runs. Shipped moved to the
// Activity panel.
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(console)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Sessions", href: "/sessions", segment: "sessions" },
          { title: "SDK", href: "/sdk", segment: "sdk" },
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

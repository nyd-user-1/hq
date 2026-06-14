import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Activity panel: Sessions · To Do · SDK tabs at the top (Sessions first — the
// "panels" button lands here; Sessions also lives in the sidebar Recents). SDK =
// Agent SDK runs, kept out of Recents. Calls (the $/call Ledger) moved to the
// Metrics panel with the other cost views.
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(activity)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Sessions", href: "/sessions", segment: "sessions" },
          { title: "To Do", href: "/todo", segment: "todo" },
          { title: "SDK", href: "/sdk", segment: "sdk" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

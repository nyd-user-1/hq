import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Activity panel: Calls · Sessions · To Do tabs at the top (Calls first — the
// "panels" button lands here; Sessions now also lives in the sidebar Recents).
// Usage + the burn meter moved out to their own /metrics view.
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(activity)/layout.tsx">
      <TabNav
        tabs={[
          { title: "Calls", href: "/calls", segment: "calls" },
          { title: "Sessions", href: "/sessions", segment: "sessions" },
          { title: "To Do", href: "/todo", segment: "todo" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

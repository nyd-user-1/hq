import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";

export const dynamic = "force-dynamic";

// Activity panel: Sessions · Calls · To Do tabs at the top (Sessions first).
// Usage + the burn meter moved out to their own /metrics view.
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(activity)/layout.tsx">
      {/* pr-16 keeps the tabs clear of the panel's floating columns/✕ controls */}
      <div className="pr-16">
        <TabNav
          tabs={[
            { title: "Sessions", href: "/sessions", segment: "sessions" },
            { title: "Calls", href: "/calls", segment: "calls" },
            { title: "To Do", href: "/todo", segment: "todo" },
          ]}
        />
      </div>
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

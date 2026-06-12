import Boundary from "@/app/ui/boundary";
import FlashOnNav from "@/app/ui/flash-on-nav";
import TabNav from "@/app/ui/tab-nav";
import TokenMeter from "@/app/ui/token-meter";
import ForecastMeter from "@/app/ui/forecast-meter";

export const dynamic = "force-dynamic";

// Activity panel: a Usage + Meters strip pinned on top (the % stock meter and
// the burn-rate flow meter, no longer a separate page), then the Sessions ·
// Calls · To Do tabs — Sessions first.
export default function ActivityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/(activity)/layout.tsx">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4">
        <TokenMeter />
        <ForecastMeter />
      </div>

      <TabNav
        tabs={[
          { title: "Sessions", href: "/sessions", segment: "sessions" },
          { title: "Calls", href: "/calls", segment: "calls" },
          { title: "To Do", href: "/todo", segment: "todo" },
        ]}
      />
      <FlashOnNav>{children}</FlashOnNav>
    </Boundary>
  );
}

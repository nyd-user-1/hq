import Boundary from "@/app/ui/boundary";
import TokenMeter from "@/app/ui/token-meter";
import ForecastMeter from "@/app/ui/forecast-meter";

export const dynamic = "force-dynamic";

// Metrics: the % stock meter (Usage) and the burn-rate flow meter, pulled out of
// the Activity tabs into their own panel view so the Sessions/Calls/To Do tabs
// sit at the top.
export default function Metrics() {
  return (
    <Boundary topOnly bleedX label="@panel/(metrics)/metrics/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <TokenMeter />
        <div className="border-t border-zinc-800 pt-4">
          <ForecastMeter />
        </div>
      </div>
    </Boundary>
  );
}

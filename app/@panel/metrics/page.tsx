import Boundary from "@/app/ui/boundary";
import TokenMeter from "@/app/ui/token-meter";
import ForecastMeter from "@/app/ui/forecast-meter";

export const dynamic = "force-dynamic";

// Metrics: the % stock meter (Usage) and the burn-rate flow meter, pulled out of
// the Activity tabs into their own panel view so the Sessions/Calls/To Do tabs
// sit at the top.
export default function Metrics() {
  return (
    <Boundary label="@panel/metrics/page.tsx">
      <TokenMeter />
      <div className="border-t border-zinc-800 pt-4">
        <ForecastMeter />
      </div>
    </Boundary>
  );
}

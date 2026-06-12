import Boundary from "@/app/ui/boundary";
import TokenMeter from "@/app/ui/token-meter";
import ForecastMeter from "@/app/ui/forecast-meter";

export const dynamic = "force-dynamic";

// The comparison page: two readings of the SAME deduped, per-model usage data.
// The % meter (stock — how much of the cap is gone) and the burn forecast
// (flow — when the cap arrives at this pace). Kept side by side so we can watch
// which one tracks the real /usage screen more faithfully over time.
export default function Meters() {
  return (
    <Boundary label="meters/page.tsx">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">Meters</h2>
        <p className="text-sm text-zinc-500">
          Two readings of the same deduped, per-model usage data — compare which
          tracks <code className="font-mono text-zinc-400">/usage</code> over
          time.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Boundary label="token-meter · % of cap (stock)">
          <TokenMeter />
        </Boundary>
        <Boundary label="forecast-meter · burn rate (flow)">
          <ForecastMeter />
        </Boundary>
      </div>
    </Boundary>
  );
}

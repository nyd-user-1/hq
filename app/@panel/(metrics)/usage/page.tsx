import Boundary from "@/app/ui/boundary";
import TokenMeter from "@/app/ui/token-meter";
import ForecastMeter from "@/app/ui/forecast-meter";

export const dynamic = "force-dynamic";

// Usage — the live rate-limit / token meters + burn forecast. Drilled into from
// the Metrics hub (/metrics); the layout draws the "‹ back" above it.
export default function Usage() {
  return (
    <Boundary topOnly bleedX label="@panel/(metrics)/usage/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <TokenMeter />

        {/* burn — set apart from the windows above */}
        <div className="mt-2 border-t border-zinc-800 pt-6">
          <ForecastMeter />
        </div>

        {/* the fine print, condensed — one readable footer, pinned to the bottom */}
        <p className="mt-auto border-t border-dashed border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-600">
          Token totals are metered from your local Claude&nbsp;Code transcripts, weighted by
          cost (cache reads ×0.1, output ×5) and model tier (Opus ×5). The rate-limit&nbsp;% is
          read straight from Claude&nbsp;Code when marked{" "}
          <span className="text-green-400">live</span>, a calibrated estimate otherwise. Burn
          projects your last 15&nbsp;minutes of pace to the 5&nbsp;AM reset — a guide, not a bill.
        </p>
      </div>
    </Boundary>
  );
}

import { Section, SectionHead, Shot } from "./primitives";

// COST — the $ observability surfaces (api-panel + calls ledger), faithful to the
// real thing with real numbers. Left: the live usage meters + 5h burn forecast.
// Right: the per-turn spend ledger. This is hq's single most concrete value prop —
// dollars you can see while the session runs, not after the bill.

function Meter({
  title,
  live,
  pct,
  color,
  stats,
}: {
  title: string;
  live?: string;
  pct: number;
  color: string;
  stats: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="text-[15px] text-zinc-200">{title}</span>
        {live && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            {live}
          </span>
        )}
      </div>
      <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-2.5 font-mono text-[13px] leading-relaxed text-zinc-500">
        <span style={{ color }}>{pct}%</span> {stats}
      </div>
    </div>
  );
}

const LEDGER = [
  { t: "3:36 AM", tok: "3.5k", cum: "481.7k", usd: "$1.96" },
  { t: "3:34 AM", tok: "10.9k", cum: "435.8k", usd: "$3.20" },
  { t: "3:34 AM", tok: "14.7k", cum: "477.1k", usd: "$4.51" },
  { t: "3:32 AM", tok: "2.1k", cum: "418.4k", usd: "$1.70" },
  { t: "3:30 AM", tok: "874", cum: "435.7k", usd: "$1.48" },
  { t: "3:29 AM", tok: "4.1k", cum: "432.8k", usd: "$2.11" },
  { t: "3:28 AM", tok: "6.1k", cum: "428.7k", usd: "$2.31" },
  { t: "3:26 AM", tok: "3.4k", cum: "422.2k", usd: "$1.93" },
];

export default function Cost() {
  return (
    <Section id="cost">
      <SectionHead
        n="2.0"
        name="Cost"
        title={
          <>
            Watch the dollars burn.
            <br />
            <span className="text-zinc-500">Live, per turn.</span>
          </>
        }
        desc={
          <>
            The five-hour window, the weekly cap, the Opus sub-limit, a burn forecast to your next reset —
            and every turn priced the moment it lands. hq reads the token counts Claude Code already writes
            and does the math on your machine.
          </>
        }
      />
      <div className="mt-14 grid items-start gap-6 lg:grid-cols-2">
        <Shot chip="api-panel">
          <div className="flex flex-col gap-6 p-3">
            <Meter title="Current session" live="LIVE" pct={52} color="#eab308" stats="· 55.3M weighted · 70.1M raw · 228 msgs · resets 3:50AM" />
            <Meter title="Current week · all models" live="LIVE" pct={46} color="#22c55e" stats="· 1.3B weighted · 1.8B raw · 4418 msgs · resets 6:00PM" />
            <Meter title="Current week · Opus" pct={31} color="#22c55e" stats="· 1.3B weighted · 1.8B raw · 4358 msgs" />
            <div className="border-t border-zinc-800 pt-5">
              <div className="text-[15px] text-zinc-200">Burn forecast · 5h block</div>
              <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full" style={{ width: "26%", background: "#f97316" }} />
                <div className="h-full w-px bg-white" />
                <div className="h-full" style={{ width: "10%", background: "#7c3a12" }} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 font-mono text-[13px] text-zinc-500">
                <span>now <span className="text-zinc-200">55.3M</span> / 212.0M · 26%</span>
                <span>by 5:00AM: <span className="text-orange-400">~36%</span></span>
              </div>
              <div className="mt-3 flex gap-5 font-mono text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-orange-500" /> used now</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: "#7c3a12" }} /> projected by reset</span>
              </div>
            </div>
          </div>
        </Shot>

        <Shot chip="calls">
          <div className="p-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-zinc-800 pb-3 font-mono text-[13px]">
              <span className="text-zinc-500">SPEND</span>
              <span className="text-emerald-400">$296.52</span>
              <span className="text-zinc-500">session</span>
              <span className="text-zinc-300">$296.52</span>
              <span className="text-zinc-500">today</span>
              <span className="text-zinc-300">$7.5k</span>
              <span className="text-zinc-500">week</span>
            </div>
            <div className="mt-1 flex flex-col">
              {LEDGER.map((r, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-baseline gap-x-4 py-[7px] font-mono text-[13px]">
                  <span className="text-zinc-600">{r.t}</span>
                  <span className="text-zinc-500">opus</span>
                  <span className="text-right text-zinc-500">{r.tok}</span>
                  <span className="text-right text-zinc-600">{r.cum}</span>
                  <span className="text-right text-amber-400">{r.usd}<span className="ml-1 text-[11px] text-amber-400/70">2×</span></span>
                </div>
              ))}
            </div>
          </div>
        </Shot>
      </div>
    </Section>
  );
}

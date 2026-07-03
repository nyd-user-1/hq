import { Section, SectionHead, Shot } from "./primitives";
import SpecDrawer, { type Spec } from "./spec-drawer";

const SPECS: Spec[] = [
  {
    n: "2.1",
    title: "Priced on your machine",
    desc: <>Per-model rates applied to the token counts on disk — including the ~2× long-context premium past the 200k cliff. An estimate by design; the math is yours to read.</>,
    file: "lib/pricing.ts",
  },
  {
    n: "2.2",
    title: "The real limits",
    desc: <>The five-hour window, the weekly cap, and the Opus sub-limit come from the usage data Claude Code itself reports — the same numbers the CLI statusline shows.</>,
    file: "lib/usage.ts",
  },
  {
    n: "2.3",
    title: "Burn forecast",
    desc: <>The current block projected to your next reset, so you see the wall before you hit it — not after the turn that crossed it.</>,
  },
  {
    n: "2.4",
    title: "The ledger",
    desc: <>Every turn stamped the moment it lands: time · model · tokens · cumulative context · dollars. Cost while the session runs, not after the bill.</>,
  },
];

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
  { t: "3:24 AM", tok: "5.2k", cum: "418.8k", usd: "$2.44" },
  { t: "3:22 AM", tok: "1.8k", cum: "413.6k", usd: "$1.32" },
  { t: "3:20 AM", tok: "9.3k", cum: "411.8k", usd: "$3.88" },
  { t: "3:18 AM", tok: "2.7k", cum: "402.5k", usd: "$1.71" },
  { t: "3:15 AM", tok: "12.4k", cum: "399.8k", usd: "$4.12" },
  { t: "3:12 AM", tok: "1.1k", cum: "387.4k", usd: "$0.94" },
  { t: "3:10 AM", tok: "7.8k", cum: "386.3k", usd: "$3.02" },
  { t: "3:08 AM", tok: "2.4k", cum: "378.5k", usd: "$1.55" },
  { t: "3:05 AM", tok: "5.6k", cum: "376.1k", usd: "$2.61" },
  { t: "3:03 AM", tok: "1.3k", cum: "370.5k", usd: "$1.08" },
  { t: "3:01 AM", tok: "9.1k", cum: "369.2k", usd: "$3.77" },
];

const SAVINGS = [
  { k: "cache reuse", tok: "840k", usd: "$12.10" },
  { k: "skipped re-reads", tok: "220k", usd: "$3.90" },
  { k: "deduped tool calls", tok: "96k", usd: "$1.60" },
  { k: "trimmed context", tok: "44k", usd: "$0.80" },
  { k: "batched file reads", tok: "38k", usd: "$0.64" },
  { k: "elided tool output", tok: "31k", usd: "$0.55" },
  { k: "reused search index", tok: "27k", usd: "$0.47" },
  { k: "compacted history", tok: "22k", usd: "$0.39" },
  { k: "shared subagent ctx", tok: "18k", usd: "$0.31" },
  { k: "memoized metrics", tok: "12k", usd: "$0.21" },
  { k: "pruned transcript", tok: "9k", usd: "$0.16" },
  { k: "skipped dup diff", tok: "6k", usd: "$0.11" },
  { k: "cached embeddings", tok: "5k", usd: "$0.09" },
  { k: "reused git blame", tok: "4k", usd: "$0.07" },
  { k: "coalesced writes", tok: "3k", usd: "$0.05" },
  { k: "warm daemon reuse", tok: "2k", usd: "$0.04" },
  { k: "skipped lint reparse", tok: "1k", usd: "$0.02" },
];

const NOTES = [
  { k: "handoff-2026-07-01-landing", t: "12m ago" },
  { k: "agent-teams-reference", t: "1h ago" },
  { k: "brendan-collaboration-style", t: "3h ago" },
  { k: "hq-product-description", t: "1d ago" },
  { k: "live-session-control", t: "2d ago" },
  { k: "session-id-is-transcript-uuid", t: "2d ago" },
  { k: "hq-dev-workflow", t: "3d ago" },
  { k: "channel-in-demoted-to-toggle", t: "3d ago" },
  { k: "feedback-look-at-the-render", t: "4d ago" },
  { k: "handoff-universal-projects", t: "4d ago" },
  { k: "hq-is-enterprise-marketplace", t: "5d ago" },
  { k: "brendan-voice-prose", t: "5d ago" },
  { k: "feedback-no-eye-emoji-glyphs", t: "6d ago" },
  { k: "agent-teams-saga", t: "6d ago" },
  { k: "hq-two-terminal-coordination", t: "7d ago" },
  { k: "look-at-the-render", t: "7d ago" },
  { k: "sonnet-for-small-tasks", t: "8d ago" },
  { k: "hq-icon-button-standard", t: "8d ago" },
];

export default function Cost() {
  return (
    <Section id="cost">
      <SectionHead
        n="2.0"
        name="Cost"
        title="Per turn token counts."
        desc={
          <>
            every turn priced the moment it lands. hq reads the token counts Claude Code already writes
            and does the math on your machine.
          </>
        }
        specs={SPECS}
      />
      {/* Horizontal scroll of the $ surfaces — equal height, a couple peeking off the
          right edge so the row invites a scroll to the rest. */}
      <div className="scrollbar-none mt-10 flex snap-x gap-6 overflow-x-auto pb-4 pt-4" style={{ height: 580 }}>
        <SpecDrawer n="2.0" name="Cost" specs={SPECS} triggerClassName="flex w-[min(85vw,500px)] shrink-0 cursor-pointer snap-start text-left">
          <Shot chip="api-panel" className="h-full w-full" activeHover>
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
        </SpecDrawer>

        <SpecDrawer n="2.0" name="Cost" specs={SPECS} triggerClassName="flex w-[min(85vw,500px)] shrink-0 cursor-pointer snap-start text-left">
          <Shot chip="calls" className="h-full w-full" activeHover>
          <div className="flex h-full flex-col p-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-zinc-800 pb-3 font-mono text-[13px]">
              <span className="text-zinc-500">SPEND</span>
              <span className="text-emerald-400">$296.52</span>
              <span className="text-zinc-500">session</span>
              <span className="text-zinc-300">$296.52</span>
              <span className="text-zinc-500">today</span>
              <span className="text-zinc-300">$7.5k</span>
              <span className="text-zinc-500">week</span>
            </div>
            <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
              <div className="hq-marquee flex flex-col">
                {[...LEDGER, ...LEDGER].map((r, i) => (
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
          </div>
          </Shot>
        </SpecDrawer>

        <SpecDrawer n="2.0" name="Cost" specs={SPECS} triggerClassName="flex w-[min(85vw,500px)] shrink-0 cursor-pointer snap-start text-left">
          <Shot chip="savings" className="h-full w-full" activeHover>
          <div className="flex h-full flex-col p-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-zinc-800 pb-3 font-mono text-[13px]">
              <span className="text-zinc-500">SAVED</span>
              <span className="text-emerald-400">1.2M tok</span>
              <span className="text-zinc-500">session</span>
              <span className="text-zinc-300">$18.40</span>
              <span className="text-zinc-500">est.</span>
            </div>
            <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
              <div className="hq-marquee flex flex-col">
                {[...SAVINGS, ...SAVINGS].map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-[9px] font-mono text-[13px]">
                    <span className="text-zinc-400">{r.k}</span>
                    <span className="text-right text-zinc-500">{r.tok}</span>
                    <span className="text-right text-emerald-400">{r.usd}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </Shot>
        </SpecDrawer>

        <SpecDrawer n="2.0" name="Cost" specs={SPECS} triggerClassName="flex w-[min(85vw,500px)] shrink-0 cursor-pointer snap-start text-left">
          <Shot chip="memory" className="h-full w-full" activeHover>
          <div className="flex h-full flex-col p-3">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-zinc-800 pb-3 font-mono text-[13px]">
              <span className="text-zinc-500">MEMORY</span>
              <span className="text-zinc-300">48 notes</span>
              <span className="text-zinc-500">~/.claude/…/memory</span>
            </div>
            <div className="relative mt-1 min-h-0 flex-1 overflow-hidden">
              <div className="hq-marquee flex flex-col">
                {[...NOTES, ...NOTES].map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-[9px] font-mono text-[13px]">
                    <span className="truncate text-zinc-400">{r.k}<span className="text-zinc-600">.md</span></span>
                    <span className="text-right text-zinc-600">{r.t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </Shot>
        </SpecDrawer>
      </div>
    </Section>
  );
}

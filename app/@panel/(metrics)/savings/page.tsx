import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import { getUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

// SEED PAGE (2026-06-12): how much money/tokens HQ is saving — or could.
// The five efficiency ideas below all shipped as v1s the same night this page
// was written; the next session's job is to explode this into a real savings
// dashboard: quantify each idea, track behavior change, show $ saved per week.

// Opus-tier prices per million tokens — the assumption behind the headline
// number. Cache reads bill at ~10% of fresh input, so every cache-read token
// is ~90% saved.
const INPUT_PER_M = 15;
const CACHE_READ_PER_M = 1.5;

function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

const IDEAS: { title: string; where: string; how: string }[] = [
  {
    title: "Cache clock",
    where: "terminal header + session cards",
    how: "the prompt cache holds ~5 minutes; reply inside the window and the whole history reads at ~10% price. The countdown teaches batching asks while it's warm instead of dribbling messages over twenty minutes.",
  },
  {
    title: "Context gauge + wrap-up nudge",
    where: "terminal header",
    how: "auto-compact is the worst-case token event — a huge summarization turn at the worst moment, plus quality loss. The gauge shows distance to it; at 70% a nudge offers a wrap-up prompt (handoff note → memory → /clear) instead.",
  },
  {
    title: "Memory + CLAUDE.md weight audit",
    where: "Memory Audit panel",
    how: "the MEMORY.md index and CLAUDE.md files load at the start of EVERY session — a standing tax. Every 1k tokens pruned is saved hundreds of times. The only compounding savings there is.",
  },
  {
    title: "Turn-cost attribution",
    where: "tool steps in the terminal stream",
    how: "each tool step shows its rough context cost; fat ones go amber/red. Seeing \"this Read cost 18k tokens\" turns expensive habits into CLAUDE.md rules.",
  },
  {
    title: "Draft buffer",
    where: "the send box (+ queue)",
    how: "asks queued while Claude works go out as ONE message — one context read instead of three. Pure behavior win, pairs with the cache clock.",
  },
];

export default async function Savings({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; pair?: string }>;
}) {
  const { session, pair } = await searchParams;
  const pins = [session && `session=${session}`, pair && `pair=${pair}`]
    .filter(Boolean)
    .join("&");
  const week = getUsage().windows.find((w) => w.label.startsWith("Week"));
  const cacheRead = week?.totals.cacheRead ?? 0;
  const savedDollars =
    (cacheRead / 1e6) * (INPUT_PER_M - CACHE_READ_PER_M);

  return (
    <Boundary topOnly bleedX label="@panel/(metrics)/savings/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <section className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            this week, prompt caching alone
          </span>
          <span className="text-2xl font-semibold text-emerald-400">
            ≈ ${Math.round(savedDollars).toLocaleString("en-US")} saved
          </span>
          <span className="text-xs text-zinc-500">
            {fmtTok(cacheRead)} tokens read from cache instead of fresh — billed
            at ~10% of input price (assumes Opus-tier rates, ${INPUT_PER_M}/M
            in). Staying inside cache windows is what keeps this number big.
          </span>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            the five levers — all live as v1s
          </h2>
          <ul className="flex flex-col gap-2">
            {IDEAS.map((idea) => (
              <li
                key={idea.title}
                className="flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-zinc-200">
                    {idea.title}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {idea.where}
                  </span>
                </span>
                <p className="text-xs leading-relaxed text-zinc-400">
                  {idea.how}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            explode this out — next session
          </h2>
          <ul className="list-inside list-disc text-xs leading-relaxed text-zinc-400">
            <li>
              quantify each lever: cache hits inside vs outside the 5-minute
              window, wrap-ups taken vs auto-compacts eaten, fat tool steps per
              session over time
            </li>
            <li>
              a could-save column: cold-cache re-reads that batching would have
              avoided, priced in $
            </li>
            <li>
              weekly trend — is behavior actually changing, or is this just a
              pretty number
            </li>
            <li>
              tie into <Link href={`/audit${pins ? `?${pins}` : ""}`} className="text-blue-400 hover:text-blue-300">Memory Audit</Link>:
              standing-tax tokens × sessions started = the prune payoff, in $
            </li>
          </ul>
        </section>
      </div>
    </Boundary>
  );
}

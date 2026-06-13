import { PRICING_CLIFF } from "./limits";

// USD cost of Claude Code token usage. ESTIMATES — published Anthropic list
// prices, per MILLION tokens, centralized so a price change is a one-line edit.
// This powers the Ledger (dollars, not tokens) and Efficiency Mode. It is a
// decision-support meter, not an invoice — treat every figure as "~".
//
// Long-context premium: on the 1M Opus tier, a call whose input context exceeds
// ~200k (PRICING_CLIFF) bills at a premium. We model that as a flat ~2x on the
// whole call — directionally right, deliberately simple, clearly an estimate.

type Rate = {
  input: number; // fresh input
  output: number;
  cacheRead: number; // cached input (read)
  cacheWrite: number; // cache creation (5m)
};

// Sonnet/Haiku at list; Opus at list ($15/$75). Fable/Mythos priced as a
// premium tier (placeholder = Opus) until measured. Match on a substring of the
// model id (e.g. "claude-opus-4-8" → opus).
const RATES: Array<[string, Rate]> = [
  ["opus", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["sonnet", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["haiku", { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  ["fable", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["mythos", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
];
const DEFAULT_RATE = RATES[0][1]; // unknown model → price as Opus (conservative)
const PREMIUM_MULT = 2; // ~2x past the cliff (estimate; see header)

function rateFor(model?: string): Rate {
  if (!model) return DEFAULT_RATE;
  const m = model.toLowerCase();
  for (const [key, r] of RATES) if (m.includes(key)) return r;
  return DEFAULT_RATE;
}

export type Usage = {
  model?: string;
  input: number;
  cacheCreate: number;
  cacheRead: number;
  output: number;
};

// Cost of one API call. `premium` = whether the long-context surcharge applied
// (this call's input context was past the cliff), so the UI can flag it.
export function callCost(u: Usage): { usd: number; premium: boolean } {
  const r = rateFor(u.model);
  const base =
    u.input * r.input +
    u.cacheCreate * r.cacheWrite +
    u.cacheRead * r.cacheRead +
    u.output * r.output;
  const contextInput = u.input + u.cacheCreate + u.cacheRead;
  const premium = contextInput > PRICING_CLIFF;
  return { usd: (base * (premium ? PREMIUM_MULT : 1)) / 1_000_000, premium };
}

// The extra dollars a call costs *because* it's past the cliff — the "bleed".
// Zero when under the cliff. (base × (premium−1).)
export function premiumBleed(u: Usage): number {
  const r = rateFor(u.model);
  const contextInput = u.input + u.cacheCreate + u.cacheRead;
  if (contextInput <= PRICING_CLIFF) return 0;
  const base =
    u.input * r.input +
    u.cacheCreate * r.cacheWrite +
    u.cacheRead * r.cacheRead +
    u.output * r.output;
  return (base * (PREMIUM_MULT - 1)) / 1_000_000;
}

// Cost of an aggregate Totals (a whole session), base rates, NO cliff premium —
// the surcharge is per-call and meaningless on a cumulative sum. A floor
// estimate for "what did this session cost".
export function baseCost(u: Usage): number {
  const r = rateFor(u.model);
  return (
    (u.input * r.input +
      u.cacheCreate * r.cacheWrite +
      u.cacheRead * r.cacheRead +
      u.output * r.output) /
    1_000_000
  );
}

export function fmtUSD(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(3)}`;
  return "$0";
}

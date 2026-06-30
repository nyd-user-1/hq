import { getRecentCalls } from "@/lib/calls";
import { getSpend } from "@/lib/usage";

// Reads the transcripts on disk (incremental + persisted index) — never cache.
export const dynamic = "force-dynamic";

// How many rows to ship to the client. The index is ALL-TIME (deduped) — tens of
// thousands — but the panel only renders the most-recent slice; `total`/`totalCost`
// carry the full aggregate for the footnote. Mirrors the route page's RENDER_CAP.
const RENDER_CAP = 2000;

// GET — the Calls ledger: a capped recent slice + the all-time aggregate + the
// session/today/week dollar spend (same shape the @panel/(metrics)/calls page
// rendered server-side). A row's full breakdown is already in `calls`, so the
// drill-down needs no second fetch.
export async function GET() {
  const all = getRecentCalls();
  const calls = all.slice(0, RENDER_CAP);
  const totalCost = all.reduce((s, c) => s + c.cost, 0);
  return Response.json({
    calls,
    total: all.length,
    totalCost,
    cap: RENDER_CAP,
    spend: getSpend(),
  });
}

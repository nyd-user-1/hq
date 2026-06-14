import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import { getSessions } from "@/lib/sessions";
import { CONTEXT_LIMIT, PRICING_CLIFF } from "@/lib/limits";
import { fmtUSD } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

// Clicking a session pins the center terminal to it via ?session=<id> — the
// terminal switches without remounting. The selected card (pinned, or the newest
// when unpinned — which is what the terminal shows) gets a green outline.
// [Live · All] filters the list: Live (default) = active within the prompt-cache
// TTL (5 min — see lib/sessions.ts) plus the selected card, so the outline never
// vanishes; All = everything, with the <ul> as the scroll region so the
// boundary stays bounded.
export default async function Sessions({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; filter?: string }>;
}) {
  const { session, filter } = await searchParams;
  const showAll = filter === "all";
  const sessions = getSessions();
  const selectedId = session ?? sessions[0]?.id;
  const shown = showAll
    ? sessions
    : sessions.filter((s) => s.active || s.id === selectedId);

  const chip = (label: string, href: string, on: boolean) => (
    <Link
      href={href}
      scroll={false}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        on
          ? "bg-blue-600 text-white"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {label}
    </Link>
  );
  const keep = session ? `session=${session}&` : "";

  return (
    <Boundary topOnly label="@panel/sessions/page.tsx">
      <div className="flex gap-2">
        {chip("Live", `/sessions?${keep}filter=live`, !showAll)}
        {chip("All", `/sessions?${keep}filter=all`, showAll)}
      </div>
      <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {shown.map((s) => {
          const selected = s.id === selectedId;
          const warm = Date.now() - s.lastActive < 5 * 60 * 1000; // prompt-cache TTL
          const ctxPct = (s.contextTokens / CONTEXT_LIMIT) * 100;
          const pastCliff = s.contextTokens >= PRICING_CLIFF;
          return (
            <li key={s.id}>
              <Link
                href={`/sessions?session=${s.id}${showAll ? "&filter=all" : ""}`}
                scroll={false}
                className={`flex flex-col gap-1 rounded-md border px-3 py-2 transition-colors ${
                  selected
                    ? "border-green-500 bg-green-500/5 ring-1 ring-green-500/40"
                    : "border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/50"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span
                    className={`size-2 self-center rounded-full ${
                      s.active ? "bg-green-500" : "bg-zinc-700"
                    }`}
                  />
                  <span className="text-sm font-medium text-zinc-200">
                    {s.project}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-600">
                    {s.id.slice(0, 8)}
                  </span>
                  {selected && (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-green-400">
                      in terminal
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 font-mono text-xs text-zinc-500">
                    {warm && (
                      <span className="text-[10px] text-amber-400">warm</span>
                    )}
                    {ago(s.lastActive)}
                  </span>
                </div>
                <p className="font-mono text-xs text-zinc-500">
                  <span className="text-emerald-300">{fmtUSD(s.cost)}</span> ·{" "}
                  {s.messages} msgs · {fmt(s.weightedTokens)} weighted
                  {s.contextTokens > 0 && (
                    <>
                      {" · "}
                      <span
                        title={
                          pastCliff
                            ? `past ${fmt(PRICING_CLIFF)} — billing at the long-context premium (~2× input)`
                            : undefined
                        }
                        className={
                          ctxPct >= 80
                            ? "text-red-400"
                            : pastCliff
                              ? "text-amber-400"
                              : ""
                        }
                      >
                        ctx {fmt(s.contextTokens)}
                        {pastCliff && " premium"}
                      </span>
                    </>
                  )}
                </p>
                {s.snippet && (
                  <p className="truncate text-xs text-zinc-400">{s.snippet}</p>
                )}
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-xs text-zinc-600">
            no live sessions right now — switch to All
          </li>
        )}
      </ul>
      <p className="text-xs text-zinc-600">
        {showAll
          ? "every Claude Code session on this machine, last 7 days"
          : "sessions active in the last 5 minutes (the cache window)"}{" "}
        · green dot = active · warm = prompt cache still hot · green outline =
        showing in the terminal · click one to drive it
      </p>
    </Boundary>
  );
}

import Link from "next/link";
import Boundary from "@/app/ui/boundary";
import BackLink from "@/app/ui/back-link";
import CopyText from "@/app/ui/copy-text";
import { getRecentCalls, getCall, type Call, type CallKind } from "@/lib/calls";
import { getSpend } from "@/lib/usage";
import { fmtUSD } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// How many rows to render. The index is ALL-TIME (deduped) — tens of thousands —
// but the DOM only gets the most-recent slice; the footnote carries the full count.
const RENDER_CAP = 2000;

// The notable (non-default) call origins, colored so they pop against the model
// name. A normal interactive call shows ONLY its model — labeling 99.6% of rows
// "interactive" would be noise. (subagent is real but you currently have none.)
const ORIGIN: Record<Exclude<CallKind, "interactive">, { word: string; cls: string }> = {
  headless: { word: "headless", cls: "text-cyan-400" },
  subagent: { word: "subagent", cls: "text-amber-400" },
  "hook/usage": { word: "hook", cls: "text-blue-300" },
};
const KIND_WORD: Record<CallKind, string> = {
  interactive: "interactive",
  headless: "headless",
  subagent: "subagent",
  "hook/usage": "hook · usage",
};

// One detail row in the drill-down.
function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-zinc-600">{k}</dt>
      <dd className="text-zinc-300">{v}</dd>
    </>
  );
}

// Drill-down: a single call's full breakdown, opened in-panel (Shipped pattern).
function CallDetail({ c, pins }: { c: Call | null; pins: string }) {
  return (
    <Boundary topOnly bleedX label="@panel/calls/page.tsx">
      <div className="flex items-center gap-3">
        <BackLink
          href={`/calls${pins ? `?${pins}` : ""}`}
          className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
        >
          ← calls
        </BackLink>
        {c ? (
          <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
            {c.project} · {c.session.slice(0, 8)} · {new Date(c.at).toLocaleTimeString()}
          </span>
        ) : (
          <span className="font-mono text-xs text-zinc-600">call not found</span>
        )}
      </div>
      {c && (
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-4 overflow-auto border-t border-zinc-800 pt-4 font-mono">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold ${c.premium ? "text-amber-400" : "text-emerald-300"}`}
            >
              {fmtUSD(c.cost)}
            </span>
            {c.premium && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                2× · past the 200k cliff
              </span>
            )}
          </div>
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-[11px]">
            <Field k="model" v={c.model} />
            <Field k="type" v={KIND_WORD[c.kind]} />
            <Field
              k="session"
              v={
                <CopyText text={c.session} className="text-zinc-300 hover:text-zinc-100">
                  {c.session}
                </CopyText>
              }
            />
            <Field k="time" v={new Date(c.at).toLocaleString()} />
            <div className="col-span-2 my-1 border-t border-dashed border-zinc-800" />
            <Field k="input" v={c.input.toLocaleString()} />
            <Field k="cache write" v={c.cacheCreate.toLocaleString()} />
            <Field k="cache read" v={c.cacheRead.toLocaleString()} />
            <Field k="output" v={c.output.toLocaleString()} />
            <Field k="raw total" v={c.raw.toLocaleString()} />
            <Field
              k="weighted"
              v={<span className="text-zinc-400">{Math.round(c.weightedTokens).toLocaleString()}</span>}
            />
          </dl>
        </div>
      )}
    </Boundary>
  );
}

// Ledger: deduped API round-trips across ALL history, priced in dollars. Columns:
//   time · project · session · type(model + notable origin) · out · raw · cost
// $ is the star; a row opens its full breakdown in-panel (?call=, Shipped pattern,
// pins carried). Data layer is incremental + persisted (lib/calls.ts).
export default async function Calls({
  searchParams,
}: {
  searchParams: Promise<{ call?: string; session?: string; pair?: string }>;
}) {
  const { call, session, pair } = await searchParams;
  // Carry the terminal pins on in-panel nav (or the card snaps back to the list).
  const pins = [session && `session=${session}`, pair && `pair=${pair}`]
    .filter(Boolean)
    .join("&");
  const pinTail = pins ? `&${pins}` : "";

  if (call) return <CallDetail c={getCall(call)} pins={pins} />;

  const all = getRecentCalls();
  const calls = all.slice(0, RENDER_CAP);
  const totalCost = all.reduce((s, c) => s + c.cost, 0);
  const spend = getSpend();

  return (
    <Boundary topOnly bleedX label="@panel/calls/page.tsx">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-xs">
        <span className="uppercase tracking-wide text-zinc-600">spend</span>
        <span className="text-emerald-300">
          {fmtUSD(spend.session)} <span className="text-zinc-600">session</span>
        </span>
        <span className="text-zinc-300">
          {fmtUSD(spend.today)} <span className="text-zinc-600">today</span>
        </span>
        <span className="text-zinc-300">
          {fmtUSD(spend.week)} <span className="text-zinc-600">week</span>
        </span>
      </div>

      <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
        {calls.map((c, i) => {
          const time = new Date(c.at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          });
          const proj = c.project.length > 8 ? `${c.project.slice(0, 8)}…` : c.project;
          const origin = c.kind === "interactive" ? null : ORIGIN[c.kind];
          return (
            <li key={c.id || i}>
              <Link
                href={`/calls?call=${encodeURIComponent(c.id)}${pinTail}`}
                prefetch={false}
                scroll={false}
                className="flex items-baseline gap-x-2.5 rounded px-1 font-mono text-xs hover:bg-zinc-900/40"
              >
                <span className="w-16 shrink-0 text-zinc-600">{time}</span>
                <span className="w-14 shrink-0 truncate text-zinc-300">{proj}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-zinc-400">{c.model}</span>
                  {origin && <span className={origin.cls}> · {origin.word}</span>}
                </span>
                <span className="w-10 shrink-0 text-right text-zinc-600">{fmt(c.output)}</span>
                <span className="w-14 shrink-0 text-right text-zinc-600">{fmt(c.raw)}</span>
                <span
                  className={`w-14 shrink-0 text-right font-medium ${
                    c.premium ? "text-amber-400" : "text-emerald-300"
                  }`}
                >
                  {fmtUSD(c.cost)}
                  {c.premium && <span className="ml-0.5 text-[10px] text-amber-500/70">2×</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-zinc-600">
        {all.length.toLocaleString()} calls · all-time (est.) · ~{fmtUSD(totalCost)} total
        {all.length > RENDER_CAP && ` · showing recent ${RENDER_CAP.toLocaleString()}`}{" "}
        · 2× = past the 200k cliff · rates in lib/pricing.ts
      </p>
    </Boundary>
  );
}

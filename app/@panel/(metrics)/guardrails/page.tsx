import Link from "next/link";
import Boundary from "@/app/ui/boundary";
import CopyText from "@/app/ui/copy-text";
import { getGuardrails, GUARDRAILS_CONFIG_PATH } from "@/lib/guardrails";
import { fmtUSD } from "@/lib/pricing";

export const dynamic = "force-dynamic";

function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

const STATUS_TEXT = {
  ok: "text-emerald-300",
  warn: "text-amber-400",
  critical: "text-red-400",
} as const;
const STATUS_BAR = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  critical: "bg-red-400",
} as const;

// A labeled horizontal meter. `marker` (0..1) draws the 200k cliff tick.
function Meter({
  pct,
  cls,
  marker,
}: {
  pct: number;
  cls: string;
  marker?: number;
}) {
  const w = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${w}%` }} />
      {marker != null && marker > 0 && marker < 1 && (
        <div
          className="absolute top-0 h-full w-px bg-zinc-500"
          style={{ left: `${marker * 100}%` }}
        />
      )}
    </div>
  );
}

// The OTel opt-in env block (no auto-write — paste it into ~/.claude/settings.json).
const OTEL_ENV_SNIPPET = `{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT": "http://localhost:3002/api/otel/v1/logs",
    "OTEL_LOGS_EXPORT_INTERVAL": "10000"
  }
}`;

// Cost guardrails: weekly-cap projection + live burn-rate alarm + the 2× cliff
// bleed + the per-session context meter (the warm-REPL bloat that blew the cap).
// Estimate from lib/calls.ts (works today); OTel measured cost shown alongside
// when enabled. Visibility, not enforcement (can't compact a live session).
export default function Guardrails() {
  const g = getGuardrails();
  const capLeft = Math.max(0, g.cap.weeklyCapUSD - g.spend.week);

  return (
    <Boundary topOnly bleedX label="@panel/(metrics)/guardrails/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto font-mono">
        {/* WEEKLY CAP */}
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="uppercase tracking-widest text-zinc-600">weekly cap</span>
            <span className="text-zinc-500">
              <span className={STATUS_TEXT[g.usage.status]}>{fmtUSD(g.spend.week)}</span>
              {" / "}
              {fmtUSD(g.cap.weeklyCapUSD)}
              {!g.cap.configured && <span className="text-zinc-600"> · default</span>}
            </span>
          </div>
          <Meter pct={g.usage.pct} cls={STATUS_BAR[g.usage.status]} />
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-zinc-600">
            <span>
              {(g.usage.pct * 100).toFixed(0)}% used · {fmtUSD(capLeft)} left
            </span>
            <span>
              {g.usage.projectedDays == null
                ? g.usage.pct >= 1
                  ? "over cap"
                  : "idle — no recent burn"
                : `~${g.usage.projectedDays.toFixed(1)}d to cap at today's burn`}
            </span>
          </div>
        </section>

        {/* BURN RATE + BLEED */}
        <section className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-md border border-zinc-800 p-3">
            <div className="uppercase tracking-widest text-zinc-600">burn rate</div>
            <div className={`mt-1 text-2xl font-bold ${STATUS_TEXT[g.burn.status]}`}>
              {fmtUSD(g.burn.perMin)}
              <span className="text-sm font-normal text-zinc-600">/min</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-600">
              ~{fmtUSD(g.burn.perHour)}/hr · last 15 min · alarm ≥ {fmtUSD(g.cap.burnRateAlertUSD)}/min
            </div>
          </div>
          <div className="rounded-md border border-zinc-800 p-3">
            <div className="uppercase tracking-widest text-zinc-600">2× cliff bleed</div>
            <div className="mt-1 text-2xl font-bold text-amber-400">
              {fmtUSD(g.bleed.week)}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-600">
              {(g.bleed.share * 100).toFixed(0)}% of the week is the past-{fmtTok(g.cliff)} surcharge
            </div>
          </div>
        </section>

        {/* MEASURED (OTel) */}
        <section className="text-xs">
          {g.measured.available ? (
            <div className="flex items-baseline justify-between gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <span className="uppercase tracking-widest text-emerald-400/70">measured · otel</span>
              <span className="text-zinc-400">
                <span className="text-emerald-300">{fmtUSD(g.measured.week)}</span> week ·{" "}
                {fmtUSD(g.measured.day)} today
                <span className="text-zinc-600"> · authoritative tokens</span>
              </span>
            </div>
          ) : (
            <details className="rounded-md border border-dashed border-zinc-800 px-3 py-2">
              <summary className="cursor-pointer list-none text-[11px] text-zinc-500">
                <span className="uppercase tracking-widest text-zinc-600">measured · otel</span>{" "}
                — off · the above is an estimate · <span className="text-blue-400">enable →</span>
              </summary>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Paste into{" "}
                <code className="text-zinc-300">~/.claude/settings.json</code> to stream Claude
                Code&apos;s own cost/usage into HQ&apos;s receiver. Opt-in; only affects sessions
                started afterward.
              </p>
              <CopyText
                text={OTEL_ENV_SNIPPET}
                title="Copy the OTel settings.json snippet"
                className="mt-2 block w-full rounded border border-zinc-800 bg-zinc-950/60 p-2.5 hover:border-zinc-700"
              >
                <pre className="scrollbar-none overflow-x-auto whitespace-pre text-[10px] leading-snug text-zinc-400">
                  {OTEL_ENV_SNIPPET}
                </pre>
                <span className="mt-1.5 block text-[10px] text-zinc-600">click to copy</span>
              </CopyText>
            </details>
          )}
        </section>

        {/* TOP SESSIONS — context bloat is what blew the cap */}
        <section className="flex min-h-0 flex-col gap-2">
          <div className="text-xs uppercase tracking-widest text-zinc-600">
            top sessions · this week
          </div>
          <ul className="flex flex-col gap-2">
            {g.sessions.length === 0 && (
              <li className="text-[11px] text-zinc-600">no calls in the last 7 days.</li>
            )}
            {g.sessions.map((s) => (
              <li key={s.sessionId} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="w-14 shrink-0 truncate text-zinc-300">{s.project}</span>
                  <span className="shrink-0 text-[10px] text-zinc-600">
                    {s.sessionId.slice(0, 8)} · {s.calls} calls
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right text-[10px] text-zinc-600">
                    ctx {fmtTok(s.context)}
                    {s.premium && <span className="text-amber-400"> · 2×</span>}
                  </span>
                  <span
                    className={`w-14 shrink-0 text-right font-medium ${
                      s.premium ? "text-amber-400" : "text-emerald-300"
                    }`}
                  >
                    {fmtUSD(s.cost)}
                  </span>
                </div>
                <Meter
                  pct={s.context / g.contextLimit}
                  cls={s.premium ? "bg-amber-400" : "bg-zinc-600"}
                  marker={g.cliff / g.contextLimit}
                />
              </li>
            ))}
          </ul>
        </section>

        <p className="text-[11px] leading-relaxed text-zinc-600">
          estimate from lib/calls.ts (rates in lib/pricing.ts) · context bar = latest call&apos;s
          context vs the 1M window, tick = the {fmtTok(g.cliff)} 2× cliff · visibility only — HQ
          can&apos;t compact a live session, only stop an HQ-spawned run · set your cap in{" "}
          <CopyText text={GUARDRAILS_CONFIG_PATH} className="text-zinc-400 hover:text-zinc-200">
            {GUARDRAILS_CONFIG_PATH.replace(/^.*\.claude/, "~/.claude")}
          </CopyText>{" "}
          (<code className="text-zinc-500">{`{"weeklyCapUSD":300,"burnRateAlertUSD":5}`}</code>) ·{" "}
          <Link href="/calls" scroll={false} className="text-blue-400 hover:text-blue-300">
            per-call ledger →
          </Link>
        </p>
      </div>
    </Boundary>
  );
}

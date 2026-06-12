import Boundary from "@/app/ui/boundary";
import { ago } from "@/lib/ago";
import { getAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

// The standing context tax, made visible: what every session pays before you
// type a word, and which memory files have gone stale. Trimming here saves
// tokens on EVERY future session — the only compounding savings there is.
export default function Audit() {
  const { everySession, perProject, memory, memoryTotalTokens, staleCount } =
    getAudit();
  const sessionTax = everySession.reduce((s, f) => s + f.tokens, 0);

  const row = (label: string, tokens: number, mtime: number) => (
    <li
      key={label}
      className="flex items-baseline gap-3 border-b border-zinc-800/60 py-1.5 font-mono text-xs"
    >
      <span className="min-w-0 flex-1 truncate text-zinc-300">{label}</span>
      <span className="shrink-0 text-zinc-400">~{fmt(tokens)} tok</span>
      <span className="w-14 shrink-0 text-right text-zinc-600">
        {ago(mtime)}
      </span>
    </li>
  );

  return (
    <Boundary label="@panel/audit/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            loaded every home session
          </h2>
          <p className="text-xs text-zinc-400">
            every new session starts ~{fmt(sessionTax)} tokens deep before you
            type a word — trimming these pays back on every session.
          </p>
          <ul>{everySession.map((f) => row(f.label, f.tokens, f.mtime))}</ul>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            per-project rules (added when working there)
          </h2>
          <ul>{perProject.map((f) => row(f.label, f.tokens, f.mtime))}</ul>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            memory store — {memory.length} files · ~{fmt(memoryTotalTokens)}{" "}
            tok · {staleCount} stale
          </h2>
          <p className="text-xs text-zinc-400">
            these load on demand, not every session — but each one is a line in
            the index above. Amber = untouched 30+ days; resolved or stale ones
            are prune candidates.
          </p>
          <ul>
            {memory.map((m) => (
              <li
                key={m.name}
                className="flex flex-col gap-0.5 border-b border-zinc-800/60 py-1.5"
              >
                <span className="flex items-baseline gap-3 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    {m.name}
                  </span>
                  {m.stale && (
                    <span className="shrink-0 text-[10px] text-amber-400">
                      stale {Math.floor((Date.now() - m.mtime) / 86400000)}d
                    </span>
                  )}
                  <span className="shrink-0 text-zinc-500">
                    ~{fmt(m.tokens)} tok
                  </span>
                </span>
                {m.description && (
                  <span className="truncate text-[11px] text-zinc-500">
                    {m.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Boundary>
  );
}

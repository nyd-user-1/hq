import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import os from "node:os";
import Markdown from "@/app/ui/md";
import BackLink from "@/app/ui/back-link";
import CopyText from "@/app/ui/copy-text";
import { ago } from "@/lib/ago";
import { getAudit, readAuditDoc } from "@/lib/audit";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

// The standing context tax, made visible: what every session pays before you
// type a word, and which memory files have gone stale. Every row opens its .md
// in the panel (?open=<path>) — the same read-it-here move as a memory search
// card. Trimming here saves tokens on EVERY future session.
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;

  // ── opened .md ──────────────────────────────────────────────────────────
  if (open) {
    const content = readAuditDoc(open);
    const home = os.homedir();
    const shown = open.startsWith(home) ? `~${open.slice(home.length)}` : open;
    return (
      <Boundary topOnly bleedX label="@panel/(metrics)/audit/page.tsx">
        <div className="flex items-baseline gap-3">
          <BackLink
            href="/audit"
            className="shrink-0 cursor-pointer font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← audit
          </BackLink>
          <CopyText
            text={open}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            {shown}
          </CopyText>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto text-sm">
          {content ? (
            <Markdown text={content} />
          ) : (
            <p className="text-xs text-zinc-600">file not found</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── audit list ────────────────────────────────────────────────────────────
  const { everySession, perProject, memory, memoryTotalTokens, staleCount } =
    getAudit();
  const sessionTax = everySession.reduce((s, f) => s + f.tokens, 0);

  // One clean line: label · ~tok · ago — clickable, opens the .md here.
  const row = (label: string, tokens: number, mtime: number, path: string) => (
    <Link
      key={label}
      href={`/audit?open=${encodeURIComponent(path)}`}
      scroll={false}
      className="flex items-baseline gap-3 border-b border-zinc-800/60 py-1.5 font-mono text-xs transition-colors hover:bg-zinc-800/30"
    >
      <span className="min-w-0 flex-1 truncate text-zinc-300">{label}</span>
      <span className="shrink-0 text-zinc-400">~{fmt(tokens)} tok</span>
      <span className="w-14 shrink-0 text-right text-zinc-600">{ago(mtime)}</span>
    </Link>
  );

  return (
    <Boundary topOnly bleedX label="@panel/(metrics)/audit/page.tsx">
      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            loaded every home session
          </h2>
          <p className="text-xs text-zinc-400">
            every new session starts ~{fmt(sessionTax)} tokens deep before you
            type a word — trimming these pays back on every session.
          </p>
          <div className="flex flex-col">
            {everySession.map((f) => row(f.label, f.tokens, f.mtime, f.path))}
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            per-project rules (added when working there)
          </h2>
          <div className="flex flex-col">
            {perProject.map((f) => row(f.label, f.tokens, f.mtime, f.path))}
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            memory store — {memory.length} files · ~{fmt(memoryTotalTokens)} tok ·{" "}
            {staleCount} stale
          </h2>
          <p className="text-xs text-zinc-400">
            these load on demand, not every session — but each one is a line in
            the index above. Amber = untouched 30+ days; resolved or stale ones
            are prune candidates.
          </p>
          <div className="flex flex-col">
            {memory.map((m) => (
              <Link
                key={m.name}
                href={`/audit?open=${encodeURIComponent(m.path)}`}
                scroll={false}
                className="flex flex-col gap-0.5 border-b border-zinc-800/60 py-1.5 transition-colors hover:bg-zinc-800/30"
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
              </Link>
            ))}
          </div>
        </section>
      </div>
    </Boundary>
  );
}

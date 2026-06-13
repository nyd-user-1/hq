import Boundary from "@/app/ui/boundary";
import RefreshWhile from "@/app/ui/refresh-while";
import { firehoseFor, type FireItem, type Tone } from "@/lib/firehose";

export const dynamic = "force-dynamic";

// FIREHOSE panel — the everything-view of a session's transcript, in-app: the
// dashboard sibling of scripts/firehose.mjs. Raw fields, nothing computed. Reads
// the current session by default (?session=<id> to pin another) and live-tails
// it (RefreshWhile re-renders the server component on an interval).

const toneClass: Record<Tone, string> = {
  add: "text-emerald-300",
  del: "text-red-300",
  ctx: "text-zinc-500",
  dim: "text-zinc-500",
  err: "text-red-400",
};
const gutter = (tone?: Tone) => (tone === "add" ? "+" : tone === "del" ? "-" : " ");

function FireRow({ it }: { it: FireItem }) {
  switch (it.t) {
    case "meta":
      return <div className="font-mono text-[10px] text-zinc-600">· {it.text}</div>;
    case "branch":
      return <div className="font-mono text-[10px] text-amber-500/80">⎇ {it.text}</div>;
    case "user":
      return (
        <div className="flex flex-col gap-0.5 pt-1">
          <div className="font-mono text-[11px] font-semibold text-blue-400">
            ● you <span className="font-normal text-zinc-600">{it.at}{it.tag ? ` · ${it.tag}` : ""}</span>
          </div>
          {it.cmd && <div className="font-mono text-[11px] text-zinc-500">/{it.cmd}</div>}
          {it.text && <div className="whitespace-pre-wrap text-[13px] text-zinc-200">{it.text}</div>}
          {it.images && <div className="font-mono text-[10px] text-zinc-600">📎 {it.images}</div>}
          {it.reminders > 0 && (
            <div className="font-mono text-[10px] text-zinc-600">+ {it.reminders} system-reminder{it.reminders > 1 ? "s" : ""}</div>
          )}
        </div>
      );
    case "assistant":
      return (
        <div className="pt-1 font-mono text-[11px] font-semibold text-amber-400">
          ● claude <span className="font-normal text-zinc-600">{it.at}{it.sub ? ` · ${it.sub}` : ""}</span>
        </div>
      );
    case "thinking":
      return <div className="font-mono text-[11px] text-violet-300">🧠 thinking — <span className="text-zinc-500">{it.text}</span></div>;
    case "text":
      return <div className="whitespace-pre-wrap text-[13px] text-zinc-200">{it.text}</div>;
    case "tool":
      return (
        <div className="font-mono text-[11px]">
          <div className="text-cyan-400">› {it.name}{it.id ? <span className="text-zinc-600"> ({it.id})</span> : null}</div>
          {it.lines.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words pl-3 ${toneClass[l.tone ?? "dim"]}`}>{l.text || " "}</div>
          ))}
          {it.more > 0 && <div className="pl-3 text-zinc-600">… {it.more} more</div>}
        </div>
      );
    case "diff":
      return (
        <div className="font-mono text-[11px]">
          <div className="text-zinc-500">
            └ {it.head} <span className="text-emerald-400">+{it.added}</span> <span className="text-red-400">-{it.removed}</span>
            {it.note ? <span className="text-zinc-600"> ({it.note})</span> : null}
          </div>
          {it.rows.map((r, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words ${toneClass[r.tone ?? "ctx"]}`}>
              {r.n != null ? String(r.n).padStart(4) : "    "} {gutter(r.tone)} {r.text || " "}
            </div>
          ))}
          {it.more > 0 && <div className="text-zinc-600">… {it.more} more lines</div>}
        </div>
      );
    case "result":
      return (
        <div className="font-mono text-[11px]">
          <div className="text-cyan-400/80">⎘ {it.head}</div>
          {it.rows.map((r, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words pl-3 ${toneClass[r.tone ?? "dim"]}`}>{r.text || " "}</div>
          ))}
          {it.more > 0 && <div className="pl-3 text-zinc-600">… {it.more} more</div>}
        </div>
      );
    case "usage":
      return (
        <div className="font-mono text-[10px] text-emerald-400/70">
          ∑ <span className="text-zinc-500">{it.main}{it.sub ? ` · ${it.sub}` : ""}{it.ms != null ? ` · ${it.ms}ms` : ""}</span>
        </div>
      );
    case "system":
      return (
        <div className="font-mono text-[10px] text-zinc-600">
          ── {it.head} ──
          {it.body && <div className="whitespace-pre-wrap pl-3 text-zinc-600">{it.body}</div>}
        </div>
      );
    case "note":
      return <div className="font-mono text-[10px] text-zinc-500">{it.icon} {it.text}</div>;
  }
}

export default async function FirehosePanel({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  const { id, project, items, full } = firehoseFor(session ?? null);

  return (
    <Boundary topOnly label="@panel/(console)/firehose/page.tsx">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xs text-zinc-300">firehose</span>
        {id ? (
          <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
            {project || "~"} · {id.slice(0, 8)}
          </span>
        ) : (
          <span className="font-mono text-xs text-zinc-600">no session</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-600">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          live
        </span>
      </div>

      <div className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto pt-1">
        {items.length === 0 ? (
          <p className="text-xs text-zinc-600">nothing in this session&apos;s transcript yet</p>
        ) : (
          <>
            {full && <div className="font-mono text-[10px] text-zinc-600">… earlier history scrolled off (showing the tail)</div>}
            {items.map((it, i) => (
              <FireRow key={i} it={it} />
            ))}
          </>
        )}
      </div>

      <p className="text-xs text-zinc-600">
        every field on disk, nothing computed · raw tokens, sealed-thinking signatures, full tool I/O · read-only
      </p>
      <RefreshWhile active ms={1500} />
    </Boundary>
  );
}

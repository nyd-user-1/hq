"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useFirehose } from "@/app/ui/firehose-state";
import type { FireItem, Firehose, Tone } from "@/lib/firehose";

// The Firehose panel — the everything-view of a session's transcript, in a
// standalone toggle panel (its own portal root #firehose-panel-root), mirroring
// the Changelog / Skills panels: AppPanel chrome over a live /api/firehose fetch.
// Raw fields, nothing computed. Reads the current/newest session and LIVE-TAILS
// it: the sibling /api/firehose/stream SSE (fs.watch-backed) pushes a `change`
// the instant a turn lands, and we re-fetch the structured items (debounced).
// FireRow is ported verbatim from app/@panel/(console)/firehose/page.tsx.

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

export default function FirehosePanel() {
  const { open, setOpen } = useFirehose();
  const [data, setData] = useState<Firehose | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/firehose", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Live tail — reuse the firehose fs.watch SSE; re-fetch the structured items on
  // each `change`. Trailing debounce so a transcript WRITE STORM collapses to ONE
  // re-fetch (mirrors RefreshOnChange's FE-7 coalescing).
  useEffect(() => {
    if (!open) return;
    const es = new EventSource("/api/firehose/stream");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        load();
      }, 250);
    };
    es.addEventListener("change", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [open, load]);

  const id = data?.id ?? null;
  const items = data?.items ?? [];
  const full = data?.full ?? false;

  return (
    <AppPanel
      rootId="firehose-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="firehose-panel.tsx">
        {/* header — firehose · project · id, with a live pulse + refresh */}
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="font-mono text-xs text-zinc-300">firehose</span>
          {id ? (
            <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
              {data?.project || "~"} · {id.slice(0, 8)}
            </span>
          ) : (
            <span className="font-mono text-xs text-zinc-600">no session</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-zinc-600">
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              live
            </span>
            <button
              onClick={() => load()}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="flex items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              <svg
                className={loading ? "animate-spin" : ""}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </button>
          </span>
        </div>

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {/* the list OWNS the scroll (min-h-0 flex-1 overflow-y-auto) so it stays
            WITHIN the panel's dashed frame; header + footer stay put (shrink-0). */}
        <div className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto pt-1">
          {items.length === 0 ? (
            <p className="text-xs text-zinc-600">
              {loading ? "loading…" : "nothing in this session’s transcript yet"}
            </p>
          ) : (
            <>
              {full && (
                <div className="font-mono text-[10px] text-zinc-600">
                  … earlier history scrolled off (showing the tail)
                </div>
              )}
              {items.map((it, i) => (
                <FireRow key={i} it={it} />
              ))}
            </>
          )}
        </div>

        <p className="shrink-0 text-xs text-zinc-600">
          every field on disk, nothing computed · raw tokens, sealed-thinking signatures, full tool I/O · read-only
        </p>
      </Boundary>
    </AppPanel>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Bucket, BucketState } from "@/lib/buckets";

const COST_GLYPH = { S: "~S", M: "~M", L: "~L" } as const;

const STATE: Record<
  BucketState,
  { label: string; text: string; bar: string; chip: string }
> = {
  shipped: {
    label: "shipped",
    text: "text-emerald-400",
    bar: "bg-emerald-500",
    chip: "border-emerald-500/40 text-emerald-400",
  },
  filling: {
    label: "filling",
    text: "text-green-400",
    bar: "bg-green-500",
    chip: "border-green-500/40 text-green-400",
  },
  ripe: {
    label: "ripe",
    text: "text-amber-400",
    bar: "bg-amber-500",
    chip: "border-amber-500/50 text-amber-400",
  },
  split: {
    label: "split",
    text: "text-red-400",
    bar: "bg-red-500",
    chip: "border-red-500/50 text-red-400",
  },
  overfull: {
    label: "overfull",
    text: "text-red-400",
    bar: "bg-red-500",
    chip: "border-red-500/50 text-red-400",
  },
  empty: {
    label: "empty",
    text: "text-zinc-500",
    bar: "bg-zinc-600",
    chip: "border-zinc-700 text-zinc-500",
  },
};

type Send = { status: "preview" | "running" | "done" | "error"; msg?: string };

function FillMeter({ bucket }: { bucket: Bucket }) {
  const s = STATE[bucket.state];
  const pct = Math.min(bucket.load / bucket.capacity, 1) * 100;
  const cohesionPct = Math.round(bucket.cohesion * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between font-mono text-xs text-zinc-500">
        <span>
          load <span className="text-zinc-300">{bucket.load}</span> /{" "}
          {bucket.capacity}
        </span>
        <span>
          cohesion <span className={s.text}>{cohesionPct}%</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${s.bar}`}
          style={{ width: `${pct}%` }}
        />
        {/* ripe threshold tick */}
        <div
          className="absolute inset-y-0 w-px bg-zinc-600"
          style={{ left: `${(4 / bucket.capacity) * 100}%` }}
        />
      </div>
      <p className={`text-xs ${s.text}`}>{bucket.verdict}</p>
    </div>
  );
}

function BucketCard({ bucket }: { bucket: Bucket }) {
  const router = useRouter();
  const [send, setSend] = useState<Send | null>(null);
  const s = STATE[bucket.state];
  const todo = bucket.tasks.filter((t) => !t.done);
  const canSend =
    todo.length > 0 && (bucket.state === "ripe" || bucket.state === "filling");

  async function confirm() {
    setSend({ status: "running" });
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: bucket.dispatchPrompt }),
      });
      if (!res.ok) setSend({ status: "error", msg: (await res.text()) || `error ${res.status}` });
      else setSend({ status: "done" });
    } catch (e) {
      setSend({ status: "error", msg: String(e) });
    } finally {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight">{bucket.title}</h3>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${s.chip}`}
        >
          {s.label}
        </span>
      </div>

      {bucket.state !== "shipped" && bucket.state !== "empty" && (
        <FillMeter bucket={bucket} />
      )}

      <ul className="flex flex-col gap-2">
        {bucket.tasks.map((t) => (
          <li key={t.title} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <span className={t.done ? "text-emerald-500" : "text-zinc-600"}>
              {t.done ? "▣" : "▢"}
            </span>
            <span className={t.done ? "text-zinc-500 line-through" : "text-zinc-200"}>
              {t.title}
            </span>
            {t.files.map((f) => (
              <code
                key={f}
                className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
              >
                {f}
              </code>
            ))}
            <span className="ml-auto font-mono text-[10px] text-zinc-600">
              {COST_GLYPH[t.cost]}
            </span>
          </li>
        ))}
      </ul>

      {bucket.workingSet.length > 0 && bucket.state !== "shipped" && (
        <p className="font-mono text-[11px] text-zinc-600">
          working set · {bucket.workingSet.length} file
          {bucket.workingSet.length === 1 ? "" : "s"} · {bucket.subsystems.length}{" "}
          subsystem{bucket.subsystems.length === 1 ? "" : "s"} ·{" "}
          {bucket.subsystems.join(" · ")}
        </p>
      )}

      {/* action zone */}
      {(bucket.state === "split" || bucket.state === "overfull") && (
        <p className="text-xs text-red-400/80">
          {bucket.state === "overfull"
            ? "Too big for one pass — split it in 003 Buckets.md."
            : "These tasks don't share a working set — split them into separate buckets in 003 Buckets.md."}
        </p>
      )}

      {canSend && !send && (
        <button
          onClick={() => setSend({ status: "preview" })}
          className={`self-start rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            bucket.state === "ripe"
              ? "border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          }`}
        >
          {bucket.state === "ripe" ? "Send all →" : "Send anyway →"}
        </button>
      )}

      {send?.status === "preview" && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            fires into the newest session · spends tokens
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-300">
            {bucket.dispatchPrompt}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={confirm}
              className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-500/20"
            >
              Confirm send →
            </button>
            <button
              onClick={() => setSend(null)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {send?.status === "running" && (
        <p className="font-mono text-xs text-amber-300">
          dispatching the bucket — the reply lands in the Dashboard terminal, can
          take minutes…
        </p>
      )}
      {send?.status === "done" && (
        <p className="font-mono text-xs text-emerald-400">
          sent ✓ — watch the Dashboard terminal for the reply.
        </p>
      )}
      {send?.status === "error" && (
        <p className="whitespace-pre-wrap font-mono text-xs text-red-400">
          {send.msg}
        </p>
      )}
    </div>
  );
}

export default function BucketBoard({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) {
    return (
      <p className="text-sm text-zinc-600">
        No buckets — add some to{" "}
        <code className="font-mono">!hq/*launchpad/003 Buckets.md</code>.
      </p>
    );
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      {buckets.map((b) => (
        <BucketCard key={b.title} bucket={b} />
      ))}
    </div>
  );
}

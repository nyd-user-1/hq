"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SweepCandidate } from "@/lib/sweep";

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)}gb`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}mb`;
  if (n >= 1024) return `${Math.round(n / 1024)}kb`;
  return `${n}b`;
}

/**
 * The sweep-or-keep list. Selection is bulk-first — these come in waves of
 * dozens, so select-all/none is the primary gesture and per-row is the
 * exception. Sweeping deletes the raw .jsonl only; the cleaned text lives on in
 * the search index, which is why a row that ISN'T indexed yet can't be swept.
 */
export default function SweepPanel({
  initial,
  thresholdDays,
}: {
  initial: SweepCandidate[];
  thresholdDays: number;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedBytes = initial
    .filter((c) => sel.has(c.id))
    .reduce((n, c) => n + c.sizeBytes, 0);
  // Un-indexed rows are excluded server-side too; surfacing the count here
  // means "Sweep 12" never silently does 9.
  const blocked = initial.filter((c) => sel.has(c.id) && !c.indexed).length;

  async function act(action: "sweep" | "keep") {
    if (!sel.size || busy) return;
    if (
      action === "sweep" &&
      !confirm(
        `Delete ${sel.size} raw transcript${sel.size === 1 ? "" : "s"} (${fmtBytes(selectedBytes)})?\n\n` +
          `The text stays searchable in HQ's archive. You lose tool results, images, and the ability to resume.`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...sel] }),
      });
      const j = await res.json();
      if (action === "sweep") {
        const skipped = (j.skipped ?? []).length;
        setMsg(
          `swept ${j.swept?.length ?? 0} · freed ${fmtBytes(j.freedBytes ?? 0)}` +
            (skipped ? ` · skipped ${skipped}` : ""),
        );
      } else {
        setMsg(`kept ${j.kept ?? 0} — they won't be offered again`);
      }
      setSel(new Set());
      router.refresh();
    } catch {
      setMsg("action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!initial.length)
    return (
      <div className="flex flex-col gap-2 p-1">
        <p className="font-mono text-xs text-zinc-500">
          Nothing past {thresholdDays} days. Claude Code&apos;s own cleanup is
          disabled (<span className="text-zinc-400">cleanupPeriodDays: 3650</span>
          ), so transcripts only leave when you say so.
        </p>
      </div>
    );

  const allSelected = sel.size === initial.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs text-zinc-300">
          {initial.length} transcript{initial.length === 1 ? "" : "s"} past{" "}
          {thresholdDays} days
        </span>
        <span className="font-mono text-[10px] text-zinc-600">
          {fmtBytes(initial.reduce((n, c) => n + c.sizeBytes, 0))} on disk
        </span>
        <button
          onClick={() =>
            setSel(allSelected ? new Set() : new Set(initial.map((c) => c.id)))
          }
          className="ml-auto font-mono text-[10px] uppercase tracking-wide text-blue-400 hover:text-blue-300"
        >
          {allSelected ? "deselect all" : "select all"}
        </button>
      </div>

      <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {initial.map((c) => (
          <label
            key={c.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 font-mono text-xs ${
              sel.has(c.id)
                ? "border-blue-500/60 bg-zinc-900"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            <input
              type="checkbox"
              checked={sel.has(c.id)}
              onChange={() => toggle(c.id)}
              className="shrink-0 accent-blue-500"
            />
            <span className="w-10 shrink-0 text-right text-[10px] text-zinc-600">
              {c.ageDays}d
            </span>
            <span className="w-20 shrink-0 truncate text-[10px] text-zinc-500">
              {c.project}
            </span>
            <span className="min-w-0 flex-1 truncate text-zinc-300">
              {c.customTitle || c.aiTitle || c.title || c.id.slice(0, 8)}
            </span>
            {!c.indexed && (
              <span
                title="not in the search index yet — sweeping would lose it, so it's refused"
                className="shrink-0 text-[10px] text-amber-400"
              >
                unindexed
              </span>
            )}
            <Link
              href={`/search?openSession=${c.id}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-[10px] text-zinc-600 hover:text-blue-300"
            >
              open
            </Link>
            <span className="w-12 shrink-0 text-right text-[10px] text-zinc-600">
              {fmtBytes(c.sizeBytes)}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
        <button
          disabled={!sel.size || busy}
          onClick={() => act("keep")}
          className="rounded border border-zinc-700 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-40"
        >
          keep {sel.size || ""}
        </button>
        <button
          disabled={!sel.size || busy}
          onClick={() => act("sweep")}
          className="rounded border border-red-500/50 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-red-300 hover:border-red-400 hover:text-red-200 disabled:opacity-40"
        >
          sweep {sel.size || ""}
          {blocked ? ` (−${blocked})` : ""}
        </button>
        {msg && (
          <span className="truncate font-mono text-[10px] text-zinc-500">
            {msg}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
          {sel.size ? fmtBytes(selectedBytes) : ""}
        </span>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// The Session Archive: search + browse EVERY Claude Code session ever (not the
// 7-day Recents window). Full-text search hits the persisted index; browse lists
// all of them, grouped by project/date. Clicking a row pins it into the terminal
// (preview alongside); "resume" copies its full-context reopen command.
type Sess = {
  id: string;
  project: string;
  title: string;
  lastActive: number;
  active: boolean;
  sizeBytes: number;
  hits?: number;
};
type Data = {
  query: string;
  total: number;
  matched?: number;
  building?: boolean;
  sessions: Sess[];
};
type GroupBy = "none" | "date" | "project";
const STORAGE_KEY = "hq:archive-group";

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / (86400 * 30))}mo`;
}
function fmtHits(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function dateBucket(ts: number, now: number): string {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (ts >= today) return "Today";
  if (ts >= today - 86_400_000) return "Yesterday";
  if (ts >= today - 7 * 86_400_000) return "Previous 7 days";
  if (ts >= today - 30 * 86_400_000) return "Previous 30 days";
  return "Older";
}
function group(sessions: Sess[], mode: GroupBy): { label: string; items: Sess[] }[] {
  if (mode === "none") return [{ label: "", items: sessions }];
  const map = new Map<string, Sess[]>();
  const key = (s: Sess) =>
    mode === "project" ? s.project : dateBucket(s.lastActive, Date.now());
  for (const s of sessions) {
    const k = key(s);
    (map.get(k) ?? map.set(k, []).get(k)!).push(s);
  }
  if (mode === "date") {
    const order = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
    return order.filter((l) => map.has(l)).map((label) => ({ label, items: map.get(label)! }));
  }
  return [...map.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => b.items[0].lastActive - a.items[0].lastActive);
}

function CopyResume({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        navigator.clipboard.writeText(`claude --resume ${id}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
        copied
          ? "border-emerald-500/40 text-emerald-300"
          : "border-zinc-800 text-zinc-600 opacity-0 hover:border-zinc-600 hover:text-zinc-300 group-hover/row:opacity-100"
      }`}
    >
      {copied ? "copied ✓" : "resume"}
    </button>
  );
}

export default function ArchiveBrowser() {
  const pathname = usePathname() ?? "/archive";
  const current = useSearchParams().get("session");
  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Data>({ query: "", total: 0, sessions: [] });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<GroupBy>("project");
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the input → query.
  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim()), 300);
    return () => clearTimeout(t);
  }, [raw]);

  // Restore the saved grouping.
  useEffect(() => {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === "none" || s === "date" || s === "project") setMode(s);
  }, []);

  // Fetch on query change; while the index is building, retry.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d: Data = await (
          await fetch(`/api/archive${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        ).json();
        if (!alive) return;
        setData(d);
        setLoading(false);
        if (d.building) retryRef.current = setTimeout(load, 2500);
      } catch {
        if (alive) setLoading(false);
      }
    };
    setLoading(true);
    load();
    return () => {
      alive = false;
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [q]);

  const choose = (m: GroupBy) => {
    setMode(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // storage disabled
    }
  };

  const groups = group(data.sessions, mode);
  const searching = !!data.query;
  const OPTS: { v: GroupBy; l: string }[] = [
    { v: "project", l: "Project" },
    { v: "date", l: "Date" },
    { v: "none", l: "None" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <input
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="search every session ever…"
        className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />

      <div className="flex shrink-0 items-center justify-between font-mono text-[11px] text-zinc-500">
        <span>
          {searching
            ? `${data.matched ?? 0} of ${data.total} match `
            : `${data.total} sessions`}
          {searching && <span className="text-zinc-300">{data.query}</span>}
          {data.building && <span className="text-amber-400"> · indexing…</span>}
        </span>
        <span className="flex items-center gap-1">
          {OPTS.map((o) => (
            <button
              key={o.v}
              onClick={() => choose(o.v)}
              className={`rounded px-1.5 py-0.5 transition-colors ${
                mode === o.v
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              {o.l}
            </button>
          ))}
        </span>
      </div>

      {loading && data.sessions.length === 0 ? (
        <p className="px-1 text-xs text-zinc-600">
          {data.building ? "building search index (first time, ~10s)…" : "loading…"}
        </p>
      ) : data.sessions.length === 0 ? (
        <p className="px-1 text-xs text-zinc-600">
          {searching ? `nothing matches "${data.query}"` : "no sessions found"}
        </p>
      ) : (
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label || "all"} className="flex flex-col gap-0.5">
              {g.label && (
                <span className="px-1 pb-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  {g.label}{" "}
                  <span className="text-zinc-700">· {g.items.length}</span>
                </span>
              )}
              {g.items.map((s) => {
                const selected = current === s.id;
                return (
                  <Link
                    key={s.id}
                    href={`${pathname}?session=${s.id}`}
                    scroll={false}
                    className={`group/row flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                      selected
                        ? "bg-zinc-800"
                        : "hover:bg-zinc-900/60"
                    }`}
                  >
                    {mode !== "project" && (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-blue-400/80">
                        {s.project}
                      </span>
                    )}
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        selected ? "text-zinc-100" : "text-zinc-300"
                      }`}
                    >
                      {s.title}
                    </span>
                    {s.hits != null && (
                      <span className="shrink-0 font-mono text-[10px] text-amber-400/90">
                        {fmtHits(s.hits)}
                      </span>
                    )}
                    {s.active && (
                      <span className="size-1.5 shrink-0 rounded-full bg-green-500" />
                    )}
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                      {ago(s.lastActive)}
                    </span>
                    <CopyResume id={s.id} />
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

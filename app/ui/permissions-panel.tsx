"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePermissions } from "@/app/ui/permissions-state";

type Bucket = "allow" | "ask" | "deny";
type PermRule = { rule: string; bucket: Bucket; category: "bash" | "mcp" | "tool"; dangerous: boolean };
type PermState = {
  defaultMode: string;
  rules: PermRule[];
  counts: { allow: number; ask: number; deny: number; dangerousAllowed: number };
};

// The permission modes we let you flip from here. bypassPermissions (the most
// permissive — never asks) is intentionally NOT one-click.
const MODES: { key: string; hint: string }[] = [
  { key: "default", hint: "ask before risky tools" },
  { key: "auto", hint: "run the allowlist, auto-approve the rest" },
  { key: "acceptEdits", hint: "auto-accept file edits" },
  { key: "plan", hint: "read-only, plan first" },
];

const CAT_DOT: Record<string, string> = { bash: "text-amber-400", mcp: "text-purple-400", tool: "text-sky-400" };

export default function PermissionsPanel() {
  const { open, setOpen } = usePermissions();
  const [state, setState] = useState<PermState | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Bucket | "dangerous">("all");
  const [cat, setCat] = useState<"all" | "bash" | "mcp" | "tool">("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/permissions", { cache: "no-store" }).then((res) => res.json());
      if (r.error) throw new Error(r.error);
      setState(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const post = async (body: object, key: string) => {
    setBusy(key);
    setErr("");
    try {
      const r = await fetch("/api/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((res) => res.json());
      if (r.error) throw new Error(r.error);
      setState(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "write failed");
    } finally {
      setBusy(null);
    }
  };
  const setBucket = (rule: string, bucket: Bucket | "remove") => post({ op: "bucket", rule, bucket }, rule);
  const setMode = (mode: string) => post({ op: "mode", mode }, "__mode__");

  const query = q.trim().toLowerCase();
  const rules = useMemo(
    () =>
      (state?.rules ?? [])
        .filter((r) => (filter === "all" ? true : filter === "dangerous" ? r.dangerous : r.bucket === filter))
        .filter((r) => cat === "all" || r.category === cat)
        .filter((r) => !query || r.rule.toLowerCase().includes(query)),
    [state, filter, cat, query],
  );

  const c = state?.counts;

  return (
    <AppPanel
      rootId="permissions-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="permissions-panel.tsx">
        {/* search + refresh */}
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={c ? `Search ${c.allow + c.ask + c.deny} rules…` : "Search permission rules…"}
            className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg className={loading ? "animate-spin" : ""} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {/* default mode — the root control (auto = the cause of the 478) */}
        <div className="shrink-0">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-500">Default mode</div>
          <div className="flex flex-wrap gap-1.5">
            {MODES.map((m) => {
              const active = state?.defaultMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key)}
                  disabled={busy === "__mode__"}
                  title={m.hint}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                    active
                      ? "border-zinc-200 bg-zinc-200 text-zinc-900"
                      : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {m.key}
                </button>
              );
            })}
            {state && !MODES.some((m) => m.key === state.defaultMode) && (
              <span className="rounded-full border border-amber-500/40 px-2.5 py-1 font-mono text-[11px] text-amber-300">{state.defaultMode}</span>
            )}
          </div>
        </div>

        {/* danger banner */}
        {c && c.dangerousAllowed > 0 && (
          <button
            type="button"
            onClick={() => { setFilter("dangerous"); }}
            className="flex shrink-0 items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-left transition-colors hover:border-red-500/50"
          >
            <span className="text-red-400">⚠</span>
            <span className="font-mono text-[11px] text-red-300">
              {c.dangerousAllowed} dangerous rule{c.dangerousAllowed > 1 ? "s" : ""} in Allow — run without asking. Review →
            </span>
          </button>
        )}

        {/* filters: bucket + category */}
        <div className="scrollbar-none flex shrink-0 gap-1.5 overflow-x-auto overscroll-x-contain">
          <FilterChip label="all" active={filter === "all"} onClick={() => setFilter("all")} n={c ? c.allow + c.ask + c.deny : undefined} />
          <FilterChip label="allow" active={filter === "allow"} onClick={() => setFilter("allow")} n={c?.allow} tint="emerald" />
          <FilterChip label="ask" active={filter === "ask"} onClick={() => setFilter("ask")} n={c?.ask} tint="amber" />
          <FilterChip label="deny" active={filter === "deny"} onClick={() => setFilter("deny")} n={c?.deny} tint="rose" />
          <FilterChip label="dangerous" active={filter === "dangerous"} onClick={() => setFilter("dangerous")} n={c?.dangerousAllowed} tint="rose" />
          <span className="w-px shrink-0 self-stretch bg-zinc-800" />
          {(["all", "bash", "mcp", "tool"] as const).map((k) => (
            <FilterChip key={k} label={k} active={cat === k} onClick={() => setCat(k)} />
          ))}
        </div>

        {/* list */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
          {rules.length ? (
            rules.map((r) => (
              <RuleRow key={`${r.bucket}:${r.rule}`} r={r} busy={busy === r.rule} onSet={setBucket} />
            ))
          ) : (
            <p className="px-0.5 font-mono text-[11px] text-zinc-600">
              {loading ? "loading…" : query ? `no rules match “${q}”.` : "no rules here."}
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {c ? `${c.allow} allow · ${c.ask} ask · ${c.deny} deny` : "—"} · writes ~/.claude/settings.json. Changes apply to new sessions.
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function FilterChip({ label, active, onClick, n, tint }: { label: string; active: boolean; onClick: () => void; n?: number; tint?: string }) {
  const activeCls =
    tint === "emerald" ? "border-emerald-400 bg-emerald-400 text-zinc-900"
    : tint === "amber" ? "border-amber-400 bg-amber-400 text-zinc-900"
    : tint === "rose" ? "border-rose-400 bg-rose-400 text-zinc-900"
    : "border-zinc-200 bg-zinc-200 text-zinc-900";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
        active ? activeCls : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      <span>{label}</span>
      {n !== undefined && <span className={`tabular-nums ${active ? "opacity-60" : "text-zinc-600"}`}>{n}</span>}
    </button>
  );
}

function RuleRow({ r, busy, onSet }: { r: PermRule; busy: boolean; onSet: (rule: string, bucket: Bucket | "remove") => void }) {
  return (
    <div className={`rounded-md border bg-zinc-900/30 p-2 ${r.dangerous && r.bucket === "allow" ? "border-red-500/40" : "border-zinc-800/70"}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 text-[10px] leading-none ${r.dangerous ? "text-red-500" : CAT_DOT[r.category]}`} title={r.dangerous ? "flagged: destructive / outbound" : r.category} aria-hidden>
          ●
        </span>
        <span className="min-w-0 flex-1 break-words font-mono text-[11px] text-zinc-200">{r.rule}</span>
        <button
          type="button"
          onClick={() => onSet(r.rule, "remove")}
          disabled={busy}
          title="Remove rule"
          aria-label="Remove"
          className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300 disabled:opacity-40"
        >
          ✕
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1 pl-4">
        {(["allow", "ask", "deny"] as Bucket[]).map((b) => {
          const on = r.bucket === b;
          const tint = b === "allow" ? "emerald" : b === "ask" ? "amber" : "rose";
          return (
            <button
              key={b}
              type="button"
              onClick={() => !on && onSet(r.rule, b)}
              disabled={busy || on}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors disabled:cursor-default ${
                on
                  ? tint === "emerald" ? "bg-emerald-500/20 text-emerald-300"
                  : tint === "amber" ? "bg-amber-500/20 text-amber-300"
                  : "bg-rose-500/20 text-rose-300"
                  : "text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
            >
              {b}
            </button>
          );
        })}
        {busy && <span className="ml-1 font-mono text-[9px] text-zinc-600">saving…</span>}
      </div>
    </div>
  );
}

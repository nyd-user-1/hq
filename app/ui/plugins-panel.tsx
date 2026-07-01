"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { GitHubMark } from "@/app/ui/brand-marks";
import { usePlugins } from "@/app/ui/plugins-state";
import type { CatalogPlugin } from "@/lib/plugin-catalog";
import type { PluginDetail } from "@/lib/plugin-detail";

// hq's Plugins panel — ONE surface over the Claude Code plugin ecosystem.
// "Yours" = what's enabled right now (the switch toggles it off → disabled).
// "Catalog" = everything else, filtered by the catalog's own categories. Click a
// card to DRILL IN (like Shipped/commits): the detail view shows the full
// description, provenance (marketplace · repo · version), and — for installed
// plugins — what it ships (commands/agents/skills/hooks, read off disk). The card
// leads with the VENDOR (Adobe, Anthropic, 42Crunch…) — the real provenance —
// and the switch enables/disables it (writes settings.json `enabledPlugins` via
// `claude plugin enable/disable` — applies next session).

// hq's own picks — sorted to the top of the catalog.
const FEATURED = new Set(["ponytail@ponytail", "caveman@caveman"]);

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PluginsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { open, setOpen } = usePlugins();
  // Embedded = hosted inside the Console container (console-panel.tsx), which owns
  // the AppPanel + Boundary and swaps panels in place. Standalone otherwise.
  const active = embedded || open;
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // drill-down: the opened plugin + its on-demand detail.
  const [selected, setSelected] = useState<CatalogPlugin | null>(null);
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNonce, setDetailNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/plugins/catalog", { cache: "no-store" }).then((res) => res.json());
      setCatalog(r?.plugins ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // fetch detail when a card is opened (or after a toggle bumps the nonce).
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let abort = false;
    setDetailLoading(true);
    fetch(`/api/plugins/detail?ref=${encodeURIComponent(selected.ref)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!abort) setDetail(d?.detail ?? null);
      })
      .catch(() => {
        if (!abort) setDetail(null);
      })
      .finally(() => {
        if (!abort) setDetailLoading(false);
      });
    return () => {
      abort = true;
    };
  }, [selected, detailNonce]);

  const query = q.trim().toLowerCase();
  const matchesQuery = useCallback(
    (p: CatalogPlugin) =>
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      (p.author ?? "").toLowerCase().includes(query) ||
      (p.category ?? "").toLowerCase().includes(query),
    [query],
  );

  // Yours = enabled (filtered by the search box). Pool = everything installable.
  const yours = catalog.filter((p) => p.enabled && matchesQuery(p));
  const pool = catalog.filter((p) => !p.enabled);

  // category chips, built from the installable pool, most-populous first.
  const cats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of pool) if (p.category) counts[p.category] = (counts[p.category] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [pool]);

  const catalogList = pool
    .filter((p) => (cat === "all" || p.category === cat) && matchesQuery(p))
    .sort(
      (a, b) =>
        Number(FEATURED.has(b.ref)) - Number(FEATURED.has(a.ref)) || a.name.localeCompare(b.name),
    );

  const detailChanged = useCallback(() => {
    load();
    setDetailNonce((n) => n + 1);
  }, [load]);

  const content = (
    <>
        {/* header — search+refresh, or back+name in the drill-down */}
        {selected ? (
          <div className="flex shrink-0 items-center">
            <button
              onClick={() => setSelected(null)}
              title="Back to catalog"
              aria-label="Back"
              className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="min-w-0 truncate font-mono text-[11px] text-zinc-100">{selected.name}</span>
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={catalog.length ? `Search ${catalog.length} plugins…` : "Search plugins…"}
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
        )}

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {selected ? (
          <PluginDetailView base={selected} detail={detail} loading={detailLoading} onChanged={detailChanged} />
        ) : (
          <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
            {/* YOURS */}
            <SectionLabel label="Yours" count={catalog.filter((p) => p.enabled).length} />
            <div className="mt-2 flex flex-col gap-4">
              {yours.length ? (
                yours.map((p) => <PluginCard key={p.ref} p={p} onOpen={setSelected} onChanged={load} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {query ? "no enabled plugins match." : "Nothing enabled yet — install one below."}
                </p>
              )}
            </div>

            {/* CATALOG — the category bar sticks while you scroll the list. NOTE:
                the scroll PARENT must stay overflow-y-only — adding overflow-x here
                breaks position:sticky rendering in Safari (cards bleed through the
                bar). overscroll-x-contain keeps a chip swipe from nudging the list. */}
            <div className="sticky top-0 z-10 mt-6 bg-[#09090b] pb-4 pt-1">
              <SectionLabel label="Catalog" count={pool.length} />
              <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto overscroll-x-contain">
                <CatChip label="all" count={pool.length} active={cat === "all"} onClick={() => setCat("all")} />
                {cats.map(([c, n]) => (
                  <CatChip key={c} label={c} count={n} active={cat === c} onClick={() => setCat(c)} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {catalogList.length ? (
                catalogList.map((p) => <PluginCard key={p.ref} p={p} onOpen={setSelected} onChanged={load} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {loading ? "loading…" : query ? `no plugins match “${q}”.` : "nothing here."}
                </p>
              )}
            </div>
          </div>
        )}

        {/* footer */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {selected
            ? "The switch enables/disables it · changes apply next session."
            : `${catalog.length} plugins across your marketplaces · install enables it, the switch toggles it, changes apply next session.`}
        </footer>
    </>
  );
  if (embedded) return content;
  return (
    <AppPanel
      rootId="plugins-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="plugins-panel.tsx">{content}</Boundary>
    </AppPanel>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex shrink-0 items-baseline gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-zinc-600">{count}</span>
    </div>
  );
}

function CatChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
        active
          ? "border-zinc-200 bg-zinc-200 text-zinc-900"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${active ? "text-zinc-500" : "text-zinc-600"}`}>{count}</span>
    </button>
  );
}

// The list card: vendor-led identity + one control. The whole card drills into
// the detail view; the control stops propagation so toggling never opens it.
function PluginCard({
  p,
  onOpen,
  onChanged,
}: {
  p: CatalogPlugin;
  onOpen: (p: CatalogPlugin) => void;
  onChanged: () => void;
}) {
  const firstParty = (p.author ?? "").toLowerCase() === "anthropic";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(p)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(p);
        }
      }}
      className="cursor-pointer rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{p.name}</span>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <EnableControl refId={p.ref} enabled={p.enabled} onChanged={onChanged} />
        </div>
      </div>

      {(p.author || p.category) && (
        <div className="mt-0.5 truncate font-mono text-[10px]">
          {p.author && (
            <span className={firstParty ? "text-orange-300/70" : "text-zinc-500"}>{p.author}</span>
          )}
          {p.author && p.category && <span className="text-zinc-700"> · </span>}
          {p.category && <span className="text-zinc-600">{titleCase(p.category)}</span>}
        </div>
      )}

      {p.description && (
        <p className="mt-3 line-clamp-2 text-[11px] leading-snug text-zinc-500">{p.description}</p>
      )}
    </div>
  );
}

// The drill-down: full description, provenance, and what the plugin ships.
function PluginDetailView({
  base,
  detail,
  loading,
  onChanged,
}: {
  base: CatalogPlugin;
  detail: PluginDetail | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const d = detail;
  const author = d?.author ?? base.author;
  const category = d?.category ?? base.category;
  const firstParty = (author ?? "").toLowerCase() === "anthropic";
  const ships = d?.ships;
  const shipsAny = ships && (ships.commands.length || ships.agents.length || ships.skills.length || ships.hooks.length);

  return (
    <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
      {/* provenance + control */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {(author || category) && (
            <div className="truncate font-mono text-[11px]">
              {author && <span className={firstParty ? "text-orange-300/80" : "text-zinc-400"}>{author}</span>}
              {author && category && <span className="text-zinc-700"> · </span>}
              {category && <span className="text-zinc-500">{titleCase(category)}</span>}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-zinc-600">
            <span>{d?.marketplace ?? base.ref.split("@")[1]}</span>
            {d?.version && (
              <>
                <span className="text-zinc-800">·</span>
                <span className="text-zinc-500">{d.version}</span>
              </>
            )}
            {d?.sha && (
              <>
                <span className="text-zinc-800">·</span>
                <span>{d.sha}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <EnableControl refId={base.ref} enabled={d?.enabled ?? base.enabled} onChanged={onChanged} />
        </div>
      </div>

      {/* full description */}
      <p className="text-[12px] leading-relaxed text-zinc-300">
        {d?.description || base.description || (loading ? "" : "No description.")}
      </p>

      {/* link — the source repository (manifest source.url) */}
      {d?.repo && (
        <div className="flex flex-wrap gap-2">
          <LinkChip
            href={d.repo}
            label="Repository"
            leading={d.repo.includes("github.com") ? <GitHubMark size={12} className="shrink-0" /> : undefined}
          />
        </div>
      )}

      {/* SHIPS — what installing this actually adds, read off disk */}
      {loading && !d ? (
        <p className="font-mono text-[11px] text-zinc-600">loading…</p>
      ) : d?.installed ? (
        shipsAny ? (
          <div className="flex flex-col gap-3 border-t border-dashed border-zinc-800 pt-4">
            <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">Ships</span>
            <ShipGroup label="Commands" items={ships!.commands.map((c) => `/${c}`)} />
            <ShipGroup label="Agents" items={ships!.agents} />
            <ShipGroup label="Skills" items={ships!.skills} />
            <ShipGroup label="Hooks" items={ships!.hooks} />
          </div>
        ) : (
          <p className="border-t border-dashed border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
            Installed — adds no commands, agents or skills.
          </p>
        )
      ) : (
        <p className="border-t border-dashed border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
          Install to see the commands, agents and skills it adds.
        </p>
      )}
    </div>
  );
}

function ShipGroup({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] text-zinc-600">
        {label} <span className="text-zinc-700">{items.length}</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="truncate rounded border border-zinc-800 bg-zinc-900/40 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function LinkChip({ href, label, leading }: { href: string; label: string; leading?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
    >
      {leading}
      {label}
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7M9 7h8v8" />
      </svg>
    </a>
  );
}

// Shared enable/disable control: the switch when on, an Install button when off.
// Used by both the list card and the drill-down.
function EnableControl({ refId, enabled, onChanged }: { refId: string; enabled: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState(enabled);
  useEffect(() => setOn(enabled), [enabled, refId]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setOn(next);
    try {
      const r = await fetch("/api/plugins/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: refId, on: next }),
      });
      const d = await r.json();
      setOn(!!d.enabled);
      onChanged();
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };

  return on ? (
    <Switch on disabled={busy} onClick={() => toggle(false)} title="disable" />
  ) : (
    <button
      type="button"
      disabled={busy}
      onClick={() => toggle(true)}
      className="rounded-md px-2 py-1 font-mono text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-60"
    >
      {busy ? "installing…" : "Install"}
    </button>
  );
}

// A macOS-style switch (green ring when on).
function Switch({ on, onClick, disabled, title }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full ring-1 transition-colors disabled:opacity-50 ${
        on ? "bg-emerald-500 ring-emerald-400" : "bg-zinc-600 ring-zinc-500"
      }`}
    >
      <span className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[15px]" : "translate-x-0.5"}`} />
    </button>
  );
}

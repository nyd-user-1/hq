"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePlugins } from "@/app/ui/plugins-state";
import type { LibView } from "@/lib/plugins";
import type { CatalogPlugin } from "@/lib/plugin-catalog";

// HQ's plugin CONTROL PANEL — a drill-down over the Claude Code plugin ecosystem.
// Home = Active · Browse · Custom. Active lists what's enabled; Browse drills into
// Plugins (all 240, A-Z) / Skills / Commands / Agents; Custom is hq's featured
// picks. Every card is unified: a not-installed plugin shows an "Install" text
// button (it installs + enables, then becomes a switch); an installed one shows
// the enable/disable switch. Search up top spans the whole catalog from any view.

// hq's featured plugins → their GitHub repos (the chip links here).
const FEATURED: Record<string, string> = {
  "ponytail@ponytail": "DietrichGebert/ponytail",
  "caveman@caveman": "JuliusBrussee/caveman",
};
const MARKETPLACE_URL = "https://github.com/anthropics/claude-plugins-official";

// Drop a command into the terminal send box (Terminal 1), focused — used for the
// few add-ons that install via npx rather than `claude plugin`.
function prefill(cmd: string) {
  window.dispatchEvent(
    new CustomEvent("hq:compose", { detail: { text: cmd, replace: true, focus: true } }),
  );
}

type View = "home" | "active" | "browse" | "custom" | "b-plugins" | "b-skills" | "b-commands" | "b-agents";
const PARENT: Record<View, View | null> = {
  home: null,
  active: "home",
  browse: "home",
  custom: "home",
  "b-plugins": "browse",
  "b-skills": "browse",
  "b-commands": "browse",
  "b-agents": "browse",
};
const TITLE: Record<View, string> = {
  home: "Control Panel",
  active: "Active",
  browse: "Browse",
  custom: "Custom",
  "b-plugins": "Plugins",
  "b-skills": "Skills",
  "b-commands": "Commands",
  "b-agents": "Agents",
};

// A normalized card row — built from a catalog plugin (ref → toggle) or a curated
// npx add-on (command → inject).
type Row = {
  key: string;
  name: string;
  description: string;
  chipLabel: string;
  chipKind: "featured" | "official" | "other";
  chipHref: string;
  ref?: string;
  command?: string;
  enabled: boolean;
  installed: boolean;
};

function catalogRow(cp: CatalogPlugin): Row {
  const repo = FEATURED[cp.ref];
  const official = cp.marketplace === "claude-plugins-official";
  return {
    key: cp.ref,
    name: cp.name,
    description: cp.description,
    ref: cp.ref,
    enabled: cp.enabled,
    installed: cp.enabled,
    chipLabel: repo ? "FEATURED" : official ? "OFFICIAL" : cp.marketplace,
    chipKind: repo ? "featured" : official ? "official" : "other",
    chipHref: repo
      ? `https://github.com/${repo}`
      : official
        ? MARKETPLACE_URL
        : `https://github.com/search?q=${encodeURIComponent(cp.marketplace)}`,
  };
}

export default function PluginsPanel() {
  const { open, setOpen } = usePlugins();
  const [items, setItems] = useState<LibView[]>([]);
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("home");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [a, b] = await Promise.all([
        fetch("/api/plugins", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/plugins/catalog", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setItems(a?.plugins ?? []);
      setCatalog(b?.plugins ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const query = q.trim().toLowerCase();
  const sorted = [...catalog].sort((a, b) => a.name.localeCompare(b.name));
  const results = query
    ? sorted.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.marketplace.toLowerCase().includes(query),
      )
    : [];
  const active = sorted.filter((p) => p.enabled);

  // Custom = hq's featured picks: ponytail + caveman (catalog refs) + impeccable (npx).
  const customRows: Row[] = [];
  for (const ref of Object.keys(FEATURED)) {
    const cp = catalog.find((p) => p.ref === ref);
    if (cp) customRows.push(catalogRow(cp));
  }
  const imp = items.find((i) => i.id === "impeccable");
  if (imp) {
    customRows.push({
      key: "impeccable",
      name: imp.name,
      description: imp.blurb,
      command: imp.command ?? "npx impeccable install",
      enabled: imp.installed,
      installed: imp.installed,
      chipLabel: "FEATURED",
      chipKind: "featured",
      chipHref: `https://github.com/${imp.repo}`,
    });
  }

  const back = () => (query ? setQ("") : PARENT[view] ? setView(PARENT[view]!) : undefined);
  const atHome = view === "home" && !query;
  const title = query ? "Search" : TITLE[view];

  return (
    <AppPanel
      rootId="plugins-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="plugins-panel.tsx">
        {/* header */}
        <div className="flex shrink-0 items-center gap-2">
          {!atHome && (
            <button onClick={back} title="Back" aria-label="Back" className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-zinc-400">{title}</span>
          <button onClick={() => load()} disabled={loading} title="Refresh" aria-label="Refresh" className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50">
            <svg className={loading ? "animate-spin" : ""} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {/* search */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={catalog.length ? `Search ${catalog.length} plugins…` : "Search plugins…"}
          className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2">
          {query ? (
            <>
              <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                {results.length} result{results.length === 1 ? "" : "s"}
              </span>
              {results.map((p) => <PluginRow key={p.ref} row={catalogRow(p)} onChanged={load} />)}
              {!results.length && !loading && <p className="font-mono text-[11px] text-zinc-600">no plugins match “{q}”.</p>}
            </>
          ) : view === "home" ? (
            <>
              <CategoryRow label="Active" desc="Plugins enabled right now." count={active.length} onClick={() => setView("active")} />
              <CategoryRow label="Browse" desc="The whole catalog — Plugins · Skills · Commands · Agents." count={catalog.length} onClick={() => setView("browse")} />
              <CategoryRow label="Custom" desc="hq's featured picks." count={customRows.length} onClick={() => setView("custom")} />
            </>
          ) : view === "active" ? (
            active.length ? active.map((p) => <PluginRow key={p.ref} row={catalogRow(p)} onChanged={load} />)
                          : <p className="font-mono text-[11px] text-zinc-600">nothing enabled yet.</p>
          ) : view === "custom" ? (
            customRows.map((r) => <PluginRow key={r.key} row={r} onChanged={load} />)
          ) : view === "browse" ? (
            <>
              <CategoryRow label="Plugins" desc="Official + added, A→Z." count={catalog.length} onClick={() => setView("b-plugins")} />
              <CategoryRow label="Skills" desc="SKILL.md you can run." count={0} onClick={() => setView("b-skills")} />
              <CategoryRow label="Commands" desc="Custom slash commands." count={0} onClick={() => setView("b-commands")} />
              <CategoryRow label="Agents" desc="Subagent definitions." count={0} onClick={() => setView("b-agents")} />
            </>
          ) : view === "b-plugins" ? (
            sorted.map((p) => <PluginRow key={p.ref} row={catalogRow(p)} onChanged={load} />)
          ) : (
            // b-skills / b-commands / b-agents — coming next
            <p className="font-mono text-[11px] leading-relaxed text-zinc-600">
              Coming next — this will list your installed {TITLE[view].toLowerCase()} (from disk + every enabled plugin) with the same install/enable switch.
            </p>
          )}
        </div>

        {/* footer */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {atHome
            ? `${catalog.length} plugins across your registered marketplaces. Search anywhere, or drill in.`
            : "Install enables it · the switch toggles it · changes apply next session."}
        </footer>
      </Boundary>
    </AppPanel>
  );
}

// A drill-down category row (sports "Sideline" pattern): label · desc · count + ›.
function CategoryRow({ label, desc, count, onClick }: { label: string; desc: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-zinc-800/70 bg-zinc-900/20 px-3 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/50"
    >
      <div className="min-w-0">
        <div className="text-[15px] text-zinc-100">{label}</div>
        <div className="mt-0.5 font-mono text-[10px] text-zinc-600">{desc}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-zinc-500">
        <span className="font-mono text-[11px] tabular-nums">{count}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
    </button>
  );
}

// The unified plugin card: name · linked chip · description + control. Not
// installed → an "Install" text button (model-picker styling); once installed →
// the enable/disable switch.
function PluginRow({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(row.enabled);
  useEffect(() => setEnabled(row.enabled), [row.enabled, row.key]);

  const toggle = async (on: boolean) => {
    if (!row.ref) return;
    setBusy(true);
    setEnabled(on);
    try {
      const r = await fetch("/api/plugins/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: row.ref, on }),
      });
      const d = await r.json();
      setEnabled(!!d.enabled);
      onChanged();
    } catch {
      setEnabled(!on);
    } finally {
      setBusy(false);
    }
  };

  const chipCls =
    row.chipKind === "official"
      ? "text-zinc-500 hover:text-orange-400"
      : row.chipKind === "featured"
        ? "text-blue-300/80 hover:text-blue-200"
        : "text-zinc-500 hover:text-zinc-300";

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 transition-colors hover:border-zinc-700">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-zinc-200">{row.name}</span>
          <a
            href={row.chipHref}
            target="_blank"
            rel="noreferrer"
            title={row.chipKind === "official" ? "Claude marketplace" : row.chipHref}
            className={`shrink-0 rounded bg-zinc-800/60 px-1 py-px font-mono text-[8px] uppercase tracking-wider transition-colors ${chipCls}`}
          >
            {row.chipLabel}
          </a>
        </div>
        {row.description && (
          <p className="mt-3 text-[11px] leading-snug text-zinc-500">
            {row.description.slice(0, 120)}
            {row.description.length > 120 ? "…" : ""}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center pt-0.5">
        {row.ref ? (
          enabled ? (
            <Switch on disabled={busy} onClick={() => toggle(false)} title="disable" />
          ) : (
            <InstallButton busy={busy} onClick={() => toggle(true)} />
          )
        ) : row.command ? (
          row.installed ? (
            <span className="font-mono text-[10px] text-emerald-300">installed</span>
          ) : (
            <InstallButton busy={false} onClick={() => prefill(row.command!)} />
          )
        ) : null}
      </div>
    </div>
  );
}

// Install control — the send-box model-picker styling: bare text, muted bg on
// hover. Shows "installing…" while the install runs.
function InstallButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
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

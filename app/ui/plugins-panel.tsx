"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePlugins } from "@/app/ui/plugins-state";
import type { Category, LibView } from "@/lib/plugins";
import type { CatalogPlugin } from "@/lib/plugin-catalog";

// The Plugins panel — HQ's library of Claude Code agent add-ons. Two sections:
// PLUGINS (behaviors you toggle on/off — ponytail, caveman, impeccable) and TOOLS
// (run/fetch — skillui, awesome-design-md). ~1/3 width.
//
// Install/run is a SWITCH that prefills the command into the terminal send box
// (the user hits enter). Shell installers (npx/curl) run on enter via the agent's
// Bash; ponytail's `/plugin` flow is interactive and must run in a real Claude
// Code TUI (the switch says so). An installed mode-plugin's switch is its real
// on/off (writes `defaultMode`, lands next session); the chips refine the level.

const CATEGORY: { id: Category; label: string; desc: string }[] = [
  { id: "plugin", label: "Plugins", desc: "Hook into the agent and change its behavior — toggle on/off." },
  { id: "tool", label: "Tools", desc: "Run or fetch to add capability or design context." },
];

// ponytail/caveman get rich curated cards (mode pickers) above, so they're hidden
// from the generic catalog list to avoid showing them twice.
const CURATED_REFS = new Set(["ponytail@ponytail", "caveman@caveman"]);

// Drop a command into the terminal send box (Terminal 1), focused, so the user
// just hits enter. Uses the existing hq:compose event the terminal listens for.
function prefill(cmd: string) {
  window.dispatchEvent(
    new CustomEvent("hq:compose", { detail: { text: cmd, replace: true, focus: true } }),
  );
}

export default function PluginsPanel() {
  const { open, setOpen } = usePlugins();
  const [items, setItems] = useState<LibView[]>([]);
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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

  const setMode = async (id: string, mode: string) => {
    setBusy(id);
    setErr("");
    const prev = items;
    setItems((xs) => xs.map((p) => (p.id === id ? { ...p, mode, on: mode !== "off" } : p)));
    try {
      const r = await fetch("/api/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, mode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed");
      setItems((xs) => xs.map((p) => (p.id === id ? d.plugin : p)));
    } catch (e) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : "failed to set mode");
    } finally {
      setBusy(null);
    }
  };

  const query = q.trim().toLowerCase();
  const results = query
    ? catalog.filter(
        (p) =>
          !CURATED_REFS.has(p.ref) &&
          (p.name.toLowerCase().includes(query) ||
            p.description.toLowerCase().includes(query) ||
            p.marketplace.toLowerCase().includes(query)),
      )
    : [];
  const active = catalog.filter((p) => p.enabled && !CURATED_REFS.has(p.ref));

  return (
    <AppPanel
      rootId="plugins-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="plugins-panel.tsx">
        {/* header (fixed) */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
            agent library
          </span>
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg
              className={loading ? "animate-spin" : ""}
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {/* search (fixed) — the whole on-disk catalog */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={catalog.length ? `Search ${catalog.length} plugins…` : "Search plugins…"}
          className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {/* the list SCROLLS inside the boundary (between the fixed header + footer)
            so the dashed border never gets overrun. */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-2">
          {query ? (
            <section className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                {results.length} result{results.length === 1 ? "" : "s"}
              </span>
              {results.slice(0, 60).map((p) => (
                <CatalogRow key={p.ref} p={p} onToggled={load} />
              ))}
              {results.length > 60 && (
                <p className="font-mono text-[10px] text-zinc-600">
                  showing 60 of {results.length} — refine your search
                </p>
              )}
              {!results.length && (
                <p className="font-mono text-[11px] text-zinc-600">no plugins match “{q}”.</p>
              )}
            </section>
          ) : (
            <>
              {CATEGORY.map((cat) => {
                const group = items.filter((i) => i.category === cat.id);
                if (!group.length) return null;
                return (
                  <section key={cat.id} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">
                        {cat.label}
                      </span>
                      <p className="font-mono text-[10px] leading-snug text-zinc-600">{cat.desc}</p>
                    </div>
                    {group.map((v) => (
                      <LibCard
                        key={v.id}
                        v={v}
                        busy={busy === v.id}
                        onMode={(m) => setMode(v.id, m)}
                        onInstalled={load}
                      />
                    ))}
                  </section>
                );
              })}

              {active.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">
                      Active
                    </span>
                    <p className="font-mono text-[10px] leading-snug text-zinc-600">
                      Other enabled Claude Code plugins.
                    </p>
                  </div>
                  {active.map((p) => (
                    <CatalogRow key={p.ref} p={p} onToggled={load} />
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        {/* footer (fixed) */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {catalog.length
            ? `${catalog.length} plugins across your registered marketplaces — search to browse, flip a switch to install/enable. Changes apply next session.`
            : "Search to browse, flip a switch to install/enable."}
        </footer>
      </Boundary>
    </AppPanel>
  );
}

// A compact catalog row — name · marketplace · description + the UNIVERSAL
// install/enable/disable switch (POST /api/plugins/toggle). Turning a not-yet-
// installed plugin on installs it first (a few seconds), then enables it.
function CatalogRow({ p, onToggled }: { p: CatalogPlugin; onToggled: () => void }) {
  const [on, setOn] = useState(p.enabled);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(p.enabled), [p.enabled, p.ref]);
  const toggle = async () => {
    const next = !on;
    setBusy(true);
    setOn(next); // optimistic
    try {
      const r = await fetch("/api/plugins/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: p.ref, on: next }),
      });
      const d = await r.json();
      setOn(!!d.enabled);
      onToggled();
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };
  const market = p.marketplace === "claude-plugins-official" ? "official" : p.marketplace;
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 transition-colors hover:border-zinc-700">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-zinc-200">{p.name}</span>
          <span className="shrink-0 rounded bg-zinc-800/60 px-1 py-px font-mono text-[8px] uppercase tracking-wider text-zinc-500">
            {market}
          </span>
        </div>
        {p.description && (
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            {p.description.slice(0, 120)}
            {p.description.length > 120 ? "…" : ""}
          </p>
        )}
      </div>
      <div className="shrink-0 pt-0.5">
        <Switch
          on={on}
          disabled={busy}
          onClick={toggle}
          title={on ? "disable" : "enable / install"}
        />
      </div>
    </div>
  );
}

// A macOS-style switch.
function Switch({
  on,
  onClick,
  disabled,
  title,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
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
      <span
        className={`inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform ${
          on ? "translate-x-[15px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function StatusChip({ v }: { v: LibView }) {
  const base = "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider";
  if (v.affordance === "modes") {
    if (!v.installed) return null;
    return v.on ? (
      <span className={`${base} bg-emerald-500/15 text-emerald-300`}>on · {v.mode}</span>
    ) : (
      <span className={`${base} bg-zinc-800/60 text-zinc-500`}>off</span>
    );
  }
  if (v.affordance === "install")
    return v.installed ? (
      <span className={`${base} bg-emerald-500/15 text-emerald-300`}>installed</span>
    ) : null;
  if (v.affordance === "run") return <span className={`${base} bg-blue-500/15 text-blue-300`}>tool</span>;
  return <span className={`${base} bg-purple-500/15 text-purple-300`}>pack</span>;
}

function LibCard({
  v,
  busy,
  onMode,
  onInstalled,
}: {
  v: LibView;
  busy: boolean;
  onMode: (m: string) => void;
  onInstalled: () => Promise<void> | void;
}) {
  const needsPrefill =
    (v.affordance === "modes" && !v.installed) ||
    (v.affordance === "install" && !v.installed) ||
    v.affordance === "run";
  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-sm text-zinc-100">{v.name}</span>
          <StatusChip v={v} />
        </span>
        <a
          href={`https://github.com/${v.repo}`}
          target="_blank"
          rel="noreferrer"
          title={v.repo}
          aria-label={`Open ${v.repo} on GitHub`}
          className="shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
        >
          {/* lucide square-arrow-out-up-right */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
            <path d="m21 3-9 9" />
            <path d="M15 3h6v6" />
          </svg>
        </a>
      </div>

      <p className="text-[12px] leading-snug text-zinc-400">{v.blurb}</p>

      {/* installed behavior plugin → real on/off switch + level chips */}
      {v.affordance === "modes" && v.installed && (
        <div className="mt-1 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <Switch
              on={v.on}
              disabled={busy}
              onClick={() => onMode(v.on ? "off" : "full")}
              title={v.on ? "turn off" : "turn on (full)"}
            />
            <span className="font-mono text-[11px] text-zinc-400">{v.on ? "on" : "off"}</span>
          </div>
          {v.on && (
            <div className="flex flex-wrap gap-1">
              {v.modes
                ?.filter((m) => m.id !== "off")
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={busy}
                    onClick={() => onMode(m.id)}
                    title={m.desc}
                    className={`rounded px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                      v.mode === m.id
                        ? "bg-blue-500/20 text-blue-200"
                        : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
            </div>
          )}
          {v.envOverride && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
              ${v.envOverride.name}={v.envOverride.value} overrides this — unset it for the toggle
              to take effect.
            </p>
          )}
          {v.caveat && <p className="font-mono text-[10px] text-zinc-600">{v.caveat}</p>}
        </div>
      )}

      {/* needs installing (a not-installed plugin) or running (a tool) → the
          prefill switch */}
      {needsPrefill &&
        (v.oneClick ? (
          <OneClickInstall id={v.id} fallbackCommand={v.command ?? ""} onInstalled={onInstalled} />
        ) : (
          v.command && (
            <InjectButton command={v.command} label={v.affordance === "run" ? "Run" : "Install"} />
          )
        ))}

      {/* installed, project-scoped plugin (impeccable) → just the how-to caveat */}
      {v.affordance === "install" && v.installed && v.caveat && (
        <p className="font-mono text-[10px] text-zinc-600">{v.caveat}</p>
      )}

      {/* a content pack → browse it on GitHub */}
      {v.affordance === "browse" && (
        <a
          href={`https://github.com/${v.repo}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-100"
        >
          Browse packs
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 7h10v10" />
            <path d="M7 17 17 7" />
          </svg>
        </a>
      )}
    </div>
  );
}

// The install/run switch — flip it to drop the command in the send box. It blips
// on (emerald) and shows where the command went, then resets (it's an action, not
// persisted state). Interactive /plugin installs say "claude terminal" instead.
// Inject button (right-aligned): for shell installs (impeccable npx) + tool runs
// (skillui) — press it to drop the command in the send box; you hit enter and the
// agent runs it via Bash. (For /plugin plugins, OneClickInstall does the real thing.)
function InjectButton({ command, label }: { command: string; label: string }) {
  const [sent, setSent] = useState(false);
  return (
    <button
      type="button"
      title={command}
      onClick={() => {
        prefill(command);
        setSent(true);
        window.setTimeout(() => setSent(false), 1800);
      }}
      className="mt-1 self-end rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1 font-mono text-[11px] text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
    >
      {sent ? "→ in send box" : label}
    </button>
  );
}

// A real one-click install — POSTs to /api/plugins/install, which drives a tmux
// claude PTY through the /plugin marketplace-add + install + confirm sequence
// (~1 min). On success the parent reloads and the card swaps to the on/off Switch.
// On failure it surfaces the error + an "or run it manually" prefill fallback.
function OneClickInstall({
  id,
  fallbackCommand,
  onInstalled,
}: {
  id: string;
  fallbackCommand: string;
  onInstalled: () => Promise<void> | void;
}) {
  const [state, setState] = useState<"idle" | "installing" | "failed">("idle");
  const [err, setErr] = useState("");
  const run = async () => {
    setState("installing");
    setErr("");
    try {
      const r = await fetch("/api/plugins/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (d.ok) {
        await onInstalled(); // reload → the card flips to the on/off switch
      } else {
        setState("failed");
        setErr(d.error || "install failed");
      }
    } catch (e) {
      setState("failed");
      setErr(e instanceof Error ? e.message : "install failed");
    }
  };
  return (
    <div className="mt-1 flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={state === "installing"}
        onClick={run}
        className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1 font-mono text-[11px] text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-70"
      >
        {state === "installing" && (
          <span className="size-2.5 animate-pulse rounded-full bg-emerald-400" />
        )}
        {state === "installing" ? "installing…" : state === "failed" ? "retry install" : "Install"}
      </button>
      {state === "installing" && (
        <span className="font-mono text-[10px] text-zinc-600">claude plugin install · a few seconds</span>
      )}
      {state === "failed" && (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="font-mono text-[10px] text-amber-400/90">{err}</span>
          {fallbackCommand && (
            <button
              type="button"
              onClick={() => prefill(fallbackCommand)}
              className="font-mono text-[10px] text-zinc-500 underline transition-colors hover:text-zinc-300"
            >
              or run it manually →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

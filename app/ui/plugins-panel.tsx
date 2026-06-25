"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePlugins } from "@/app/ui/plugins-state";
import type { Category, LibView } from "@/lib/plugins";

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
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/plugins", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed to load");
      setItems(d.plugins ?? []);
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

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {/* the cards SCROLL inside the boundary (between the fixed header + footer)
            so the dashed border never gets overrun. */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-2">
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
                  <LibCard key={v.id} v={v} busy={busy === v.id} onMode={(m) => setMode(v.id, m)} />
                ))}
              </section>
            );
          })}
          {!items.length && !loading && (
            <p className="font-mono text-[11px] text-zinc-600">no add-ons.</p>
          )}
        </div>

        {/* footer (fixed) */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          Flip a switch to drop its command in your send box — hit ↵. Shell installs
          (npx/curl) run there; ponytail&apos;s <span className="text-zinc-400">/plugin</span> flow
          runs in an interactive Claude session. Mode changes apply next session.
        </footer>
      </Boundary>
    </AppPanel>
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
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-emerald-500" : "bg-zinc-600"
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
}: {
  v: LibView;
  busy: boolean;
  onMode: (m: string) => void;
}) {
  const needsPrefill =
    (v.affordance === "modes" && !v.installed) ||
    (v.affordance === "install" && !v.installed) ||
    v.affordance === "run";
  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
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
      {needsPrefill && v.command && (
        <PrefillSwitch
          command={v.command}
          label={v.affordance === "run" ? "Run" : "Install"}
          interactive={v.interactive}
        />
      )}

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
function PrefillSwitch({
  command,
  label,
  interactive,
}: {
  command: string;
  label: string;
  interactive?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2.5">
      <Switch
        on={armed}
        title={`${label} — drops the command in your send box`}
        onClick={() => {
          prefill(command);
          setArmed(true);
          window.setTimeout(() => setArmed(false), 2500);
        }}
      />
      <span className="font-mono text-[11px] text-zinc-300">
        {armed ? (interactive ? "→ paste in your claude terminal" : "→ in send box · hit ↵") : label}
      </span>
    </div>
  );
}

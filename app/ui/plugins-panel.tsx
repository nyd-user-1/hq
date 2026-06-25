"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePlugins } from "@/app/ui/plugins-state";
import type { Category, LibView } from "@/lib/plugins";

// The Plugins panel — HQ's library of Claude Code agent add-ons you toggle/run
// here instead of cloning repos. Two sections: PLUGINS (behaviors you toggle
// on/off — ponytail, caveman, impeccable) and TOOLS (run/fetch — skillui,
// awesome-design-md). Mirrors the API panel chrome; ~1/3 width.
//
// Install/run is a TOGGLE that prefills the command into the terminal send box
// (the user hits enter) — `/plugin …` is interactive, so HQ can't run it headless.
// The mode control (installed ponytail/caveman) writes the plugin's `defaultMode`
// config; it lands on the NEXT session (the footer says so).

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
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
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
          <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        {CATEGORY.map((cat) => {
          const group = items.filter((i) => i.category === cat.id);
          if (!group.length) return null;
          return (
            <section key={cat.id} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
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

        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          Toggling install/run drops the command in your send box — hit ↵ to fire it. Mode
          changes apply to your <span className="text-zinc-400">next session</span> (plugins
          load at session start).
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function StatusChip({ v }: { v: LibView }) {
  const base = "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider";
  if (v.affordance === "modes") {
    if (!v.installed) return <span className={`${base} bg-zinc-800/60 text-zinc-500`}>not installed</span>;
    return v.on ? (
      <span className={`${base} bg-emerald-500/15 text-emerald-300`}>on · {v.mode}</span>
    ) : (
      <span className={`${base} bg-zinc-800/60 text-zinc-500`}>off</span>
    );
  }
  if (v.affordance === "install")
    return v.installed ? (
      <span className={`${base} bg-emerald-500/15 text-emerald-300`}>installed</span>
    ) : (
      <span className={`${base} bg-zinc-800/60 text-zinc-500`}>not installed</span>
    );
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
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-sm text-zinc-200">{v.name}</span>
          <StatusChip v={v} />
        </span>
        <a
          href={`https://github.com/${v.repo}`}
          target="_blank"
          rel="noreferrer"
          title={v.repo}
          className="shrink-0 font-mono text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
        >
          {v.repo}
        </a>
      </div>

      <p className="text-[12px] leading-snug text-zinc-500">{v.blurb}</p>

      {/* a behavior plugin that's installed → its mode segmented control */}
      {v.affordance === "modes" && v.installed && (
        <>
          <div className="flex flex-wrap gap-1">
            {v.modes?.map((m) => {
              const active = v.mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onMode(m.id)}
                  title={m.desc}
                  className={`rounded px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-50 ${
                    active
                      ? m.id === "off"
                        ? "bg-zinc-700 text-zinc-100"
                        : "bg-blue-500/20 text-blue-200"
                      : "bg-zinc-800/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {v.envOverride && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
              ${v.envOverride.name}={v.envOverride.value} overrides this — unset it for the toggle
              to take effect.
            </p>
          )}
          {v.caveat && <p className="font-mono text-[10px] text-zinc-600">{v.caveat}</p>}
        </>
      )}

      {/* needs installing (a not-installed plugin) or running (a tool) → the
          prefill toggle */}
      {((v.affordance === "modes" && !v.installed) ||
        (v.affordance === "install" && !v.installed) ||
        v.affordance === "run") &&
        v.command && (
          <ActionToggle command={v.command} label={v.affordance === "run" ? "Run" : "Install"} />
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
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-100"
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

// The install/run toggle — flips to drop its command in the send box. Styled as a
// switch; after firing it shows the "in send box" hint for a beat.
function ActionToggle({ command, label }: { command: string; label: string }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        title={command}
        onClick={() => {
          prefill(command);
          setSent(true);
          window.setTimeout(() => setSent(false), 2500);
        }}
        className={`inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
          sent
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-zinc-700 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        }`}
      >
        <span
          className={`size-2.5 rounded-full transition-colors ${
            sent ? "bg-emerald-400" : "bg-zinc-600"
          }`}
        />
        {sent ? "in send box · hit ↵" : label}
      </button>
      <code className="break-all font-mono text-[10px] text-zinc-600">{command}</code>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePlugins } from "@/app/ui/plugins-state";
import type { PluginView } from "@/lib/plugins";

// The Plugins panel — HQ's library of Claude Code agent plugins you toggle on/off
// instead of cloning repos. Mirrors the API panel: its own portal root
// (#plugins-panel-root), AppPanel chrome, a live fetch. ponytail + caveman seed
// it; the library grows by adding PLUGINS rows in lib/plugins.ts. Each toggle
// writes the plugin's `defaultMode` config, which lands on your NEXT session
// (their hooks load at session start) — the footer says so plainly.
export default function PluginsPanel() {
  const { open, setOpen } = usePlugins();
  const [plugins, setPlugins] = useState<PluginView[]>([]);
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
      setPlugins(d.plugins ?? []);
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
    const prev = plugins;
    // optimistic — flip locally, revert on failure (the API panel's pattern).
    setPlugins((ps) => ps.map((p) => (p.id === id ? { ...p, mode, on: mode !== "off" } : p)));
    try {
      const r = await fetch("/api/plugins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, mode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "failed");
      setPlugins((ps) => ps.map((p) => (p.id === id ? d.plugin : p)));
    } catch (e) {
      setPlugins(prev);
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
      // ~1/3 width (≈425px measured) — narrower than the default third's xl bump
      // to 420px, which rendered ~482px. Drops the xl bump, holding the 360px
      // floor at all breakpoints. Expand still goes to 42vw.
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="plugins-panel.tsx">
        {/* header — title + refresh */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">
            plugin library
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
        </div>

        {err && (
          <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {err}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {plugins.map((p) => (
            <PluginCard key={p.id} p={p} busy={busy === p.id} onMode={(m) => setMode(p.id, m)} />
          ))}
          {!plugins.length && !loading && (
            <p className="font-mono text-[11px] text-zinc-600">no plugins.</p>
          )}
        </div>

        {/* footer — the honest control-surface caveat */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          Changes apply to your <span className="text-zinc-400">next session</span> — these
          plugins load at session start, so HQ can&apos;t reconfigure one already running.
        </footer>
      </Boundary>
    </AppPanel>
  );
}

function PluginCard({
  p,
  busy,
  onMode,
}: {
  p: PluginView;
  busy: boolean;
  onMode: (m: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 p-3">
      {/* provenance row — name + on/off pill + repo link */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-sm text-zinc-200">{p.name}</span>
          {p.on ? (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
              on · {p.mode}
            </span>
          ) : (
            <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              off
            </span>
          )}
        </span>
        <a
          href={`https://github.com/${p.repo}`}
          target="_blank"
          rel="noreferrer"
          title={p.repo}
          className="shrink-0 font-mono text-[10px] text-zinc-600 transition-colors hover:text-zinc-400"
        >
          {p.repo}
        </a>
      </div>

      <p className="text-[12px] leading-snug text-zinc-500">{p.blurb}</p>

      {p.installed ? (
        <>
          {/* segmented control — Off + each level (the plugin's `defaultMode`
              vocabulary); Off is the on/off, the rest are intensities. */}
          <div className="flex flex-wrap gap-1">
            {p.modes.map((m) => {
              const active = p.mode === m.id;
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
          {p.envOverride && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] text-amber-300">
              ${p.envOverride.name}={p.envOverride.value} overrides this — unset it for the
              toggle to take effect.
            </p>
          )}
          {p.caveat && <p className="font-mono text-[10px] text-zinc-600">{p.caveat}</p>}
        </>
      ) : (
        <NotInstalled install={p.install} />
      )}
    </div>
  );
}

function NotInstalled({ install }: { install: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
        not installed
      </span>
      <button
        type="button"
        title="copy install command"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(install);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked */
          }
        }}
        className="group flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-left font-mono text-[10px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
      >
        <span className="break-all">{install}</span>
        <span className="ml-auto shrink-0 text-zinc-600 group-hover:text-zinc-400">
          {copied ? "copied" : "copy"}
        </span>
      </button>
    </div>
  );
}

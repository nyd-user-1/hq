"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { useSettings } from "@/app/ui/settings-state";

// Shapes mirror lib/settings-config.ts's SettingsSummary — INLINED here (not
// `import type`) so Turbopack never drags node:fs into the client bundle.
type SettingRow = { key: string; value: string; masked?: boolean };
type SettingsSection = { title: string; rows: SettingRow[] };
type SettingsSummary = {
  path: string;
  exists: boolean;
  sections: SettingsSection[];
  raw: string;
  error?: string;
};

// Defensive client-side mask: the reader already masks secret-looking ENV values
// at the source, but any row whose KEY signals a credential is masked here too —
// belt-and-suspenders so a token can never paint to screen.
const SECRET_RE = /TOKEN|KEY|SECRET|PASSWORD|AUTH/i;
function display(row: SettingRow): { value: string; masked: boolean } {
  if (row.masked) return { value: row.value, masked: true };
  if (SECRET_RE.test(row.key)) return { value: "••••••••", masked: true };
  return { value: row.value, masked: false };
}

// hq's Settings panel — a read-only viewer of ~/.claude/settings.json, the
// user-global Claude Code config. A standalone client-state portal, cloned from
// permissions-panel.tsx: AppPanel chrome, a live /api/settings fetch, grouped
// key/value sections + a collapsible raw JSON dump. Read-only — the Permissions
// panel is the one that writes.
export default function SettingsPanel() {
  const { open, setOpen } = useSettings();
  const [data, setData] = useState<SettingsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [rawOpen, setRawOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/settings", { cache: "no-store" }).then((res) => res.json());
      setData(r);
      // Only a real parse failure (file exists but unreadable) is an error; a
      // missing file is the friendly empty-state, not a banner.
      if (r.error && r.exists) setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const sections = data?.sections ?? [];
  const total = useMemo(
    () => sections.reduce((acc, s) => acc + s.rows.length, 0),
    [sections],
  );

  return (
    <AppPanel
      rootId="settings-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(420px,40vw)]"
    >
      <Boundary label="settings-panel.tsx">
        {/* header — title + refresh */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">settings.json</span>
          <button
            onClick={() => load()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh"
            className="flex shrink-0 items-center rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <svg className={loading ? "animate-spin" : ""} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        </div>

        {/* path of the file we're reading */}
        {data?.path && (
          <div className="shrink-0 truncate font-mono text-[10px] text-zinc-600" title={data.path}>
            {data.path}
          </div>
        )}

        {err && (
          <p className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">{err}</p>
        )}

        {/* scrollable body — grouped sections, then the collapsible raw JSON */}
        <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-2">
          {sections.length ? (
            sections.map((sec) => (
              <section key={sec.title} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">{sec.title}</span>
                  <span className="font-mono text-[10px] tabular-nums text-zinc-600">{sec.rows.length}</span>
                </div>
                <div className="flex flex-col gap-px overflow-hidden rounded-md border border-zinc-800/70">
                  {sec.rows.map((row) => {
                    const d = display(row);
                    return (
                      <div
                        key={row.key}
                        className="flex items-start gap-3 bg-zinc-900/30 px-2.5 py-1.5"
                      >
                        <span className="min-w-0 shrink-0 break-words font-mono text-[11px] text-zinc-500" style={{ flexBasis: "40%" }}>
                          {row.key}
                        </span>
                        <span
                          className={`min-w-0 flex-1 break-words text-right font-mono text-[11px] ${
                            d.masked ? "text-amber-400/80" : "text-zinc-200"
                          }`}
                          title={d.masked ? "masked secret" : undefined}
                        >
                          {d.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <p className="px-0.5 font-mono text-[11px] text-zinc-600">
              {loading ? "loading…" : data && !data.exists ? "no settings.json on disk." : "nothing here."}
            </p>
          )}

          {/* collapsible raw JSON — secrets already masked in the dump */}
          {data?.raw && (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setRawOpen((v) => !v)}
                aria-expanded={rawOpen}
                className="flex items-center gap-1.5 self-start font-mono text-[10px] uppercase tracking-wide text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${rawOpen ? "rotate-90" : ""}`}
                  aria-hidden
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                Raw JSON
              </button>
              {rawOpen && (
                <pre className="scrollbar-none overflow-x-auto rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 font-mono text-[10px] leading-relaxed text-zinc-400">
                  {data.raw}
                </pre>
              )}
            </section>
          )}
        </div>

        {/* footer */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {data ? `${total} setting${total === 1 ? "" : "s"} · ${sections.length} group${sections.length === 1 ? "" : "s"}` : "—"} · read-only view of ~/.claude/settings.json. Secrets masked.
        </footer>
      </Boundary>
    </AppPanel>
  );
}

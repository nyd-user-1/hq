"use client";

import { useEffect, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePreview } from "@/app/ui/preview-state";

// The Preview panel — an in-app live view of a project's local dev server. HQ
// owns the connection lifecycle: it polls the target URL and, while the server
// is down (a restart, a crash), shows a "reconnecting…" overlay over the frame,
// then reloads + snaps back the moment it returns — so a dev-server bounce is an
// in-app blip instead of Safari's "can't connect" dead page. Because HQ itself
// runs on its OWN server, mission control never blinks; only this panel waits.
//
// PROTOTYPE: a tiny project→URL map. Productized, this comes from ~/code/* + a
// per-project port setting; for now bankit (served on :4321) is the worked
// example, with hq's own :3002 as a second pick.
const PROJECTS: { name: string; url: string }[] = [
  { name: "bankit", url: "http://localhost:4321" },
  { name: "hq", url: "http://localhost:3002" },
];

export default function PreviewPanel() {
  const { open, setOpen } = usePreview();
  const [url, setUrl] = useState(PROJECTS[0].url);
  const [draft, setDraft] = useState(PROJECTS[0].url);
  const [online, setOnline] = useState<boolean | null>(null); // null = first probe pending
  const [reloadKey, setReloadKey] = useState(0);
  const wasOnline = useRef<boolean | null>(null);

  // Probe the target on an interval. A resolved fetch (opaque, no-cors) means the
  // server answered = up; a rejected fetch = down. iframe onerror is unreliable
  // cross-origin, so we drive the up/down state from this probe instead. On a
  // down→up transition, bump the iframe key to force a reload (the snap-back).
  // Poll faster while down so recovery feels instant.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ping = async () => {
      let up = false;
      try {
        await fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store" });
        up = true;
      } catch {
        up = false;
      }
      if (!alive) return;
      setOnline(up);
      if (up && wasOnline.current === false) setReloadKey((k) => k + 1); // recovered → reload
      wasOnline.current = up;
      timer = setTimeout(ping, up ? 4000 : 1500);
    };
    ping();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, url]);

  const applyUrl = (u: string) => {
    const next = u.trim();
    if (!next) return;
    setUrl(next);
    setDraft(next);
    wasOnline.current = null;
    setOnline(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <AppPanel open={open} onClose={() => setOpen(false)} rootId="preview-panel-root">
      <Boundary label="preview-panel.tsx">
        <div className="flex min-h-0 flex-1 flex-col gap-2 font-mono">
          {/* header: status dot · "preview" · project chips */}
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 pb-2 text-[11px]">
            <span
              title={online === false ? "dev server offline" : online ? "live" : "checking…"}
              className={`size-2 shrink-0 rounded-full ${
                online === false
                  ? "animate-pulse bg-amber-500"
                  : online
                    ? "bg-emerald-500"
                    : "bg-zinc-600"
              }`}
            />
            <span className="text-zinc-300">preview</span>
            <span className="text-zinc-600">·</span>
            {PROJECTS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyUrl(p.url)}
                className={`rounded px-1.5 py-0.5 transition-colors ${
                  url === p.url
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* editable URL + reload */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyUrl(draft);
            }}
            className="flex items-center gap-1"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              placeholder="http://localhost:…"
              className="min-w-0 flex-1 rounded bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              title="Reload preview"
              className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          </form>

          {/* the live frame + reconnect overlay */}
          <div className="relative min-h-0 flex-1 overflow-hidden rounded border border-zinc-800 bg-white">
            <iframe
              key={reloadKey}
              src={url}
              title="dev server preview"
              className="h-full w-full border-0"
            />
            {online === false && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/92 text-center">
                <span className="size-2.5 animate-pulse rounded-full bg-amber-500" />
                <p className="font-mono text-xs text-zinc-200">dev server offline</p>
                <p className="font-mono text-[10px] text-zinc-500">reconnecting to {url}…</p>
              </div>
            )}
          </div>
        </div>
      </Boundary>
    </AppPanel>
  );
}

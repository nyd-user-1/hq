"use client";

import { useEffect, useRef, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import { usePreview } from "@/app/ui/preview-state";
import type { PreviewProject } from "@/lib/preview-projects";

// The Preview panel — an in-app live view of a project's local dev server. HQ
// owns the connection lifecycle: it polls the target, shows "reconnecting…" while
// it's down, and reloads + snaps back when it returns (a server bounce is an
// in-app blip, not Safari's dead page). The project list is UNIVERSAL — every
// project hq knows (session cwds ∪ projectsRoot), each with a dev URL inferred
// from its package.json (overridable + persisted) and a live dot.
export default function PreviewPanel() {
  const { open, setOpen } = usePreview();
  const [projects, setProjects] = useState<PreviewProject[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const wasOnline = useRef<boolean | null>(null);
  const pickedRef = useRef(false); // auto-select the first live project just once
  const urlRef = useRef<HTMLInputElement>(null);

  // Load the universal project list on open, then refresh on an interval (cheap
  // localhost TCP checks) so the live dots stay current. Auto-select the first
  // LIVE project (else the first with a URL) so the panel shows something useful.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await fetch("/api/preview-projects", { cache: "no-store" }).then((r) => r.json());
        if (!alive) return;
        const list: PreviewProject[] = Array.isArray(d?.projects) ? d.projects : [];
        setProjects(list);
        if (!pickedRef.current) {
          const pick = list.find((p) => p.live && p.url) ?? list.find((p) => p.url);
          if (pick?.url) {
            pickedRef.current = true;
            setSelectedPath(pick.path);
            setUrl(pick.url);
            setDraft(pick.url);
            wasOnline.current = null;
            setOnline(null);
            setReloadKey((k) => k + 1);
          }
        }
      } catch {
        /* keep the last list */
      }
      timer = setTimeout(load, 8000);
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open]);

  // Probe the SELECTED url for the reconnect overlay (down→up reloads the frame).
  // iframe onerror is unreliable cross-origin, so drive up/down from this probe.
  useEffect(() => {
    if (!open || !url) return;
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
      if (up && wasOnline.current === false) setReloadKey((k) => k + 1);
      wasOnline.current = up;
      timer = setTimeout(ping, up ? 4000 : 1500);
    };
    ping();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, url]);

  const applyUrl = (u: string, persistForPath?: string | null) => {
    const next = u.trim();
    if (!next) return;
    setUrl(next);
    setDraft(next);
    wasOnline.current = null;
    setOnline(null);
    setReloadKey((k) => k + 1);
    // persist as the project's override so it sticks next time (e.g. a static
    // site like bankit with no dev script, served on a port you typed once)
    if (persistForPath) {
      fetch("/api/preview-projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: persistForPath, url: next }),
      }).catch(() => {});
    }
  };

  const pickProject = (p: PreviewProject) => {
    setSelectedPath(p.path);
    if (p.url) applyUrl(p.url);
    else {
      // no detected URL — focus the bar so you type one (saved on submit)
      setDraft("");
      setTimeout(() => urlRef.current?.focus(), 0);
    }
  };

  const liveCount = projects.filter((p) => p.live).length;
  const sorted = [...projects].sort((a, b) => Number(b.live) - Number(a.live));

  return (
    <AppPanel open={open} onClose={() => setOpen(false)} rootId="preview-panel-root">
      <Boundary label="preview-panel.tsx">
        <div className="flex min-h-0 flex-1 flex-col gap-2 font-mono">
          {/* header: status dot · "preview" · live count */}
          <div className="flex items-center gap-2 border-b border-zinc-800/60 pb-2 text-[11px]">
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
            {projects.length > 0 && (
              <span className="text-zinc-600">
                · {liveCount} live / {projects.length}
              </span>
            )}
          </div>

          {/* project chips — the universal list; live ones first, the running ones
              marked with a green dot (no clutter-dots on the rest). Selected =
              boxed pill, matching the desktop look. */}
          <div className="scrollbar-none flex items-center gap-2 overflow-x-auto pb-1 text-[11px]">
            {sorted.map((p) => (
              <button
                key={p.path}
                type="button"
                onClick={() => pickProject(p)}
                title={
                  p.url
                    ? `${p.url}${p.source === "override" ? " (saved)" : p.framework ? ` (${p.framework})` : ""}`
                    : "no dev URL detected — click, then type one to save it"
                }
                className={`shrink-0 rounded-md px-2 py-0.5 transition-colors ${
                  selectedPath === p.path
                    ? `bg-zinc-800 ${p.live ? "text-emerald-300" : "text-zinc-100"}`
                    : p.live
                      ? "text-emerald-400 hover:bg-zinc-800/50 hover:text-emerald-300"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
              >
                {p.name}
              </button>
            ))}
            {projects.length === 0 && <span className="text-zinc-600">loading projects…</span>}
          </div>

          {/* editable URL + reload — submitting saves it as the selected project's override */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyUrl(draft, selectedPath);
            }}
            className="flex items-center gap-1"
          >
            <input
              ref={urlRef}
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
            {url ? (
              <iframe key={reloadKey} src={url} title="dev server preview" className="h-full w-full border-0" />
            ) : (
              <div className="flex h-full items-center justify-center bg-zinc-950 px-6 text-center font-mono text-[11px] text-zinc-500">
                Pick a project above to preview its dev server.
              </div>
            )}
            {url && online === false && (
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

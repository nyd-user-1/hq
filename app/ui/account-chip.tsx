"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The account chip at the bottom of the sidebar — the Claude.ai account row, in
// HQ's dark theme: avatar · name / plan · a get-apps button · a ▲▼ chevron that
// opens an UPWARD menu (Settings · Language · Get help — View all plans · Get apps
// · Learn more — Log out). Purely presentational for now (every item is a no-op
// that just closes) — wired up later.

const SVG = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconDownload = () => (
  <svg {...SVG}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" x2="12" y1="15" y2="3" />
  </svg>
);
const IconChevrons = () => (
  <svg {...SVG}>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);
const IconSettings = () => (
  <svg {...SVG}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconGlobe = () => (
  <svg {...SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);
const IconHelp = () => (
  <svg {...SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);
const IconPlans = () => (
  <svg {...SVG}>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </svg>
);
const IconInfo = () => (
  <svg {...SVG}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);
const IconLogOut = () => (
  <svg {...SVG}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" x2="9" y1="12" y2="12" />
  </svg>
);
const IconChevronRight = () => (
  <svg {...SVG} width={13} height={13}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);
const IconCheck = () => (
  <svg {...SVG} width={13} height={13}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
// lucide FlaskConical — marks the EXPERIMENTAL channel-in path (see lib/channel-mode.ts).
const IconFlask = () => (
  <svg {...SVG}>
    <path d="M10 2v7.31a2 2 0 0 1-.26.98L4.5 20a1 1 0 0 0 .87 1.5h13.26a1 1 0 0 0 .87-1.5l-5.24-9.71a2 2 0 0 1-.26-.98V2" />
    <path d="M8.5 2h7" />
    <path d="M7 16h10" />
  </svg>
);

function MenuRow({
  icon,
  label,
  hint,
  chevron,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  chevron?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
    >
      <span className="shrink-0 text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 font-mono text-[10px] text-zinc-600">{hint}</span>}
      {chevron && <span className="shrink-0 text-zinc-600"><IconChevronRight /></span>}
    </button>
  );
}

export default function AccountChip() {
  const [open, setOpen] = useState(false);
  // The EXPERIMENTAL channel-in toggle (lib/channel-mode.ts). Default OFF = the
  // proven warm-REPL "MVP" path. This menu is the ONLY way to turn it on, so it
  // can never engage by accident. Synced from /api/channel-mode when the menu opens.
  const [channelOn, setChannelOn] = useState(false);
  // Language sub-menu: expands inline under the Language row. Selection is
  // local-only for now (presentational, like the rest of this menu).
  const [langOpen, setLangOpen] = useState(false);
  const [lang, setLang] = useState("English");
  const ref = useRef<HTMLDivElement>(null);

  // Pull the live toggle state each time the menu opens (cheap; reflects edits made
  // elsewhere, e.g. a stale-state recovery, so the pill never lies).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/channel-mode")
      .then((r) => r.json())
      .then((d) => { if (alive) setChannelOn(!!d?.enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open]);

  const toggleChannel = async () => {
    const next = !channelOn;
    setChannelOn(next); // optimistic; the menu stays open so the flip is visible
    try {
      const r = await fetch("/api/channel-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const d = await r.json();
      setChannelOn(!!d?.enabled);
    } catch {
      setChannelOn(!next); // revert on failure
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative shrink-0">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-2 w-[15rem] max-w-full rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl"
        >
          <div className="truncate px-2 py-1.5 font-mono text-[11px] text-zinc-500">
            brendan@nysgpt.com
          </div>
          <MenuRow icon={<IconSettings />} label="Settings" hint="⇧⌘," onClick={close} />
          {/* The experimental channel-in toggle. A single stateful row (not two
              On/Off items) so the pill always reflects reality. Stays open on click
              so the flip is visible. Amber = ON (experimental); zinc = OFF (MVP). */}
          <button
            role="menuitemcheckbox"
            aria-checked={channelOn}
            onClick={toggleChannel}
            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <span className={`shrink-0 ${channelOn ? "text-amber-400" : "text-zinc-400"}`}>
              <IconFlask />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Channel <span className="text-zinc-600">· experimental</span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                channelOn ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {channelOn ? "On" : "Off"}
            </span>
          </button>
          {/* Language expands inline into its options. The chevron rotates down
              when open; the current pick shows on the right. Selecting one sets
              the local state and collapses the sub-menu (menu stays open). */}
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={langOpen}
            onClick={() => setLangOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
          >
            <span className="shrink-0 text-zinc-400"><IconGlobe /></span>
            <span className="min-w-0 flex-1 truncate">Language</span>
            <span className="shrink-0 text-zinc-600">{lang}</span>
            <span className={`shrink-0 text-zinc-600 transition-transform ${langOpen ? "rotate-90" : ""}`}>
              <IconChevronRight />
            </span>
          </button>
          {langOpen && (
            <div role="menu" className="ml-[1.0625rem] border-l border-zinc-800 pl-1">
              {["English", "Español"].map((l) => (
                <button
                  key={l}
                  role="menuitemradio"
                  aria-checked={lang === l}
                  onClick={() => { setLang(l); setLangOpen(false); }}
                  className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
                >
                  <span className="shrink-0 text-emerald-400">
                    {lang === l ? <IconCheck /> : <span className="inline-block size-[13px]" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{l}</span>
                </button>
              ))}
            </div>
          )}
          <MenuRow icon={<IconHelp />} label="Get help" onClick={close} />
          <div className="my-1 h-px bg-zinc-800" />
          <MenuRow icon={<IconPlans />} label="View all plans" onClick={close} />
          <MenuRow icon={<IconDownload />} label="Get apps and extensions" onClick={close} />
          <MenuRow icon={<IconInfo />} label="Learn more" chevron onClick={close} />
          <div className="my-1 h-px bg-zinc-800" />
          <MenuRow icon={<IconLogOut />} label="Log out" onClick={close} />
        </div>
      )}

      <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-zinc-900"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-semibold text-zinc-100">
            B
          </span>
          <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
            <span className="truncate text-xs font-semibold text-zinc-100">Brendan</span>
            <span className="truncate text-[10px] text-zinc-500">Max plan</span>
          </span>
        </button>
        <button
          title="Get apps and extensions"
          aria-label="Get apps and extensions"
          className="flex shrink-0 items-center rounded-md border border-zinc-800 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <IconDownload />
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Account menu"
          className="flex shrink-0 items-center rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
        >
          <IconChevrons />
        </button>
      </div>
    </div>
  );
}

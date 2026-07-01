"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPanel from "@/app/ui/app-panel";
import Boundary from "@/app/ui/boundary";
import Markdown from "@/app/ui/md";
import { useSkills } from "@/app/ui/skills-state";
import type { LibrarySkill } from "@/lib/skills-library";

// hq's Skills panel — a standalone client-state portal, cloned from
// plugins-panel.tsx, the first console panel to leave @panel/(console). ONE
// surface over every skill you can run: "Yours" = the skills under
// ~/.claude/skills; "Library" = everything shipped by your enabled plugins plus
// the harness built-ins, filtered by source. Click a card to drill into the
// detail (full description + a Run that loads /<name> into the terminal).

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

// Load a command into the terminal send box (Terminal 1), focused — the user
// hits enter to run it. Skills can't be force-run from here; this stages them.
function prefill(cmd: string) {
  window.dispatchEvent(
    new CustomEvent("hq:compose", { detail: { text: cmd, replace: true, focus: true } }),
  );
}

export default function SkillsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const { open, setOpen } = useSkills();
  // Embedded = hosted inside the Console container (console-panel.tsx), which owns
  // the AppPanel + Boundary and swaps panels in place. Standalone otherwise.
  const active = embedded || open;
  const [skills, setSkills] = useState<LibrarySkill[]>([]);
  const [q, setQ] = useState("");
  const [src, setSrc] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<LibrarySkill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/skills", { cache: "no-store" }).then((res) => res.json());
      setSkills(r?.skills ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const query = q.trim().toLowerCase();
  const matchesQuery = useCallback(
    (s: LibrarySkill) =>
      !query ||
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.sourceLabel.toLowerCase().includes(query),
    [query],
  );

  // Yours = your own skills. Library = everything from plugins + built-ins.
  const yours = skills.filter((s) => s.source === "user" && matchesQuery(s));
  const pool = skills.filter((s) => s.source !== "user");

  // source chips for the library, most-populous first.
  const sources = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of pool) counts[s.sourceLabel] = (counts[s.sourceLabel] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [pool]);

  const library = pool
    .filter((s) => (src === "all" || s.sourceLabel === src) && matchesQuery(s))
    .sort((a, b) => a.name.localeCompare(b.name));

  const content = (
    <>
        {/* header — search+refresh, or back+name in the drill-down */}
        {selected ? (
          <div className="flex shrink-0 items-center">
            <button
              onClick={() => setSelected(null)}
              title="Back to skills"
              aria-label="Back"
              className="flex min-w-0 max-w-full items-center gap-2 rounded-md px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="min-w-0 truncate font-mono text-[11px] text-zinc-100">/{selected.name}</span>
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={skills.length ? `Search ${skills.length} skills…` : "Search skills…"}
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
          <SkillDetailView skill={selected} />
        ) : (
          <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
            {/* YOURS */}
            <SectionLabel label="Yours" count={skills.filter((s) => s.source === "user").length} />
            <div className="mt-2 flex flex-col gap-4">
              {yours.length ? (
                yours.map((s) => <SkillCard key={s.id} s={s} onOpen={setSelected} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {query ? "no skills of yours match." : "No skills under ~/.claude/skills yet."}
                </p>
              )}
            </div>

            {/* LIBRARY — source bar sticks while you scroll (overflow-y-only parent
                so Safari's position:sticky keeps painting; see plugins-panel). */}
            <div className="sticky top-0 z-10 mt-6 bg-[#09090b] pb-4 pt-1">
              <SectionLabel label="Library" count={pool.length} />
              <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto overscroll-x-contain">
                <SrcChip label="all" count={pool.length} active={src === "all"} onClick={() => setSrc("all")} />
                {sources.map(([s, n]) => (
                  <SrcChip key={s} label={s} count={n} active={src === s} onClick={() => setSrc(s)} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {library.length ? (
                library.map((s) => <SkillCard key={s.id} s={s} onOpen={setSelected} />)
              ) : (
                <p className="px-0.5 font-mono text-[11px] text-zinc-600">
                  {loading ? "loading…" : query ? `no skills match “${q}”.` : "nothing here."}
                </p>
              )}
            </div>
          </div>
        )}

        {/* footer */}
        <footer className="shrink-0 border-t border-dashed border-zinc-800 pt-3 font-mono text-[10px] leading-relaxed text-zinc-600">
          {selected
            ? "Run loads the command into the terminal — hit enter to fire it."
            : `${skills.length} skills · yours, plugin-shipped, and built-in. Click one to open it.`}
        </footer>
    </>
  );
  if (embedded) return content;
  return (
    <AppPanel
      rootId="skills-panel-root"
      open={open}
      onClose={() => setOpen(false)}
      widthClass="sm:w-[min(360px,40vw)]"
    >
      <Boundary label="skills-panel.tsx">{content}</Boundary>
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

function SrcChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
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

// The right-edge meta: token estimate for real files; "Built-in" carries no file.
function SkillMeta({ s }: { s: LibrarySkill }) {
  if (s.source === "builtin") {
    return <span className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">built-in</span>;
  }
  return <span className="font-mono text-[10px] text-zinc-600">~{fmt(s.tokens)} tok</span>;
}

// The list card: /name + Run, with the source/tok beneath. The card body drills
// into the detail; the Run button stages "/name " into the send box.
function SkillCard({ s, onOpen }: { s: LibrarySkill; onOpen: (s: LibrarySkill) => void }) {
  const [staged, setStaged] = useState(false);
  const dot = s.source === "user" ? "text-blue-500" : s.source === "builtin" ? "text-orange-500" : "text-emerald-500";
  const run = (e: React.MouseEvent) => {
    e.stopPropagation();
    prefill(`/${s.name} `);
    setStaged(true);
    setTimeout(() => setStaged(false), 1200);
  };
  // tok card → show its tok (the source label there just repeated the name);
  // built-ins (no file) keep their source ("Built-in").
  const subLabel = s.tokens > 0 ? `~${fmt(s.tokens)} tok` : s.sourceLabel;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(s);
        }
      }}
      className="cursor-pointer rounded-md border border-zinc-800/70 bg-zinc-900/30 p-2.5 text-left transition-colors hover:border-zinc-600"
    >
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className={`shrink-0 text-[10px] leading-none ${dot}`} aria-hidden>●</span>
          <span className="truncate font-mono text-[13px] text-zinc-200">/{s.name}</span>
          {s.workflow && (
            <span className="shrink-0 rounded bg-fuchsia-500/15 px-1 py-0.5 font-mono text-[8px] uppercase tracking-wide text-fuchsia-300">
              workflow
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={run}
          title={`Stage /${s.name} in the send box`}
          className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          {staged ? "Staged ↵" : "Run"}
        </button>
      </div>

      <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">{subLabel}</div>

      {s.description && (
        <p className="mt-3 line-clamp-2 text-[11px] leading-snug text-zinc-500">{s.description}</p>
      )}
    </div>
  );
}

// The drill-down: source + Run, then the FULL SKILL.md — the actual instructions
// the skill runs on (fetched on open). Built-ins have no file, so they show their
// description only.
function SkillDetailView({ skill: s }: { skill: LibrarySkill }) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!s.path) {
      setBody(null);
      return;
    }
    let abort = false;
    setLoading(true);
    setBody(null);
    fetch(`/api/skills/doc?path=${encodeURIComponent(s.path)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!abort) setBody(d?.body ?? null);
      })
      .catch(() => {
        if (!abort) setBody(null);
      })
      .finally(() => {
        if (!abort) setLoading(false);
      });
    return () => {
      abort = true;
    };
  }, [s.path]);

  return (
    <div className="scrollbar-none -mr-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-mono text-[11px]">
          <span className="text-zinc-400">{s.sourceLabel}</span>
          <span className="text-zinc-700"> · </span>
          <SkillMeta s={s} />
        </div>
        <button
          type="button"
          onClick={() => prefill(`/${s.name} `)}
          title={`Load /${s.name} into the terminal`}
          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Run
        </button>
      </div>

      {s.argHint && (
        <div className="font-mono text-[11px] text-zinc-500">
          Usage <span className="text-zinc-300">/{s.name} {s.argHint}</span>
        </div>
      )}

      {/* the description as a lead, then the full SKILL.md body */}
      {s.description && (
        <p className="text-[12px] leading-relaxed text-zinc-400">{s.description}</p>
      )}

      {!s.path ? (
        <p className="border-t border-dashed border-zinc-800 pt-4 font-mono text-[11px] text-zinc-600">
          Built-in — compiled into the CLI, no SKILL.md to read. Run it from the terminal.
        </p>
      ) : loading ? (
        <p className="font-mono text-[11px] text-zinc-600">loading SKILL.md…</p>
      ) : body ? (
        <div className="border-t border-dashed border-zinc-800 pt-4 text-[13px] leading-relaxed text-zinc-300">
          <Markdown text={body} />
        </div>
      ) : (
        <p className="font-mono text-[11px] text-zinc-600">couldn’t read SKILL.md.</p>
      )}
    </div>
  );
}

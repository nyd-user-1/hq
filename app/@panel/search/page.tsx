import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import Markdown from "@/app/ui/md";
import SearchInput from "@/app/ui/search-input";
import RefreshWhile from "@/app/ui/refresh-while";
import CopyText from "@/app/ui/copy-text";
import { ago } from "@/lib/ago";
import { turnsFor } from "@/lib/transcript";
import { retainedTranscriptText } from "@/lib/archive";
import {
  search,
  recent,
  getMemoryFile,
  memoryFilePath,
  getScriptFile,
  scriptFilePath,
  queryTokens,
  SCOPES,
  type SearchScope,
  type SortDir,
  type SearchHit,
} from "@/lib/search";
import { getNoteFile } from "@/lib/notes";
import { readDoc, warmDocs } from "@/lib/docs";
import { getRepoFile } from "@/lib/files";
import { getCommit } from "@/lib/shipped";
import { readSkillDoc } from "@/lib/skills";
import { getProjectSessions } from "@/lib/projects";
import { getTodos } from "@/lib/todo";
import { COMPONENTS, readComponentSource } from "@/lib/components";
import DraggableCard from "@/app/ui/draggable-card";
import SearchScopeFilter from "@/app/ui/search-scope-filter";
import { KIND_TAG } from "@/app/ui/search-tags";

// The footer's left slot — the result's identity: a short session id, else the
// file path, else the bare ref.
function footRef(h: SearchHit): string {
  if (h.kind === "transcript" || h.kind === "session" || h.kind === "sdk")
    return h.ref.slice(0, 8);
  return h.path ?? h.ref;
}

// Shared chrome for the new in-panel readers (file/component/commit/todo/
// project/skill): the "← results" back link + a click-to-copy path header over a
// scroll body. The original memory/transcript/note/script readers predate this
// and keep their inline shells; new corpora share this one.
function ReaderShell({
  back,
  label,
  copy,
  children,
}: {
  back: string;
  label: string;
  copy?: string;
  children: React.ReactNode;
}) {
  return (
    <Boundary label="@panel/search/page.tsx">
      <div className="flex items-baseline gap-3">
        <Link
          href={back}
          scroll={false}
          className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
        >
          ← results
        </Link>
        {copy ? (
          <CopyText
            text={copy}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            {label}
          </CopyText>
        ) : (
          <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
            {label}
          </span>
        )}
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-auto">{children}</div>
    </Boundary>
  );
}

// Source-code reader body (file / component source / commit diff) — wrapped mono.
const CODE_BODY =
  "whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300";

export const dynamic = "force-dynamic";

// Mark WHY a snippet matched. Prefer the contiguous phrase — the query tokens
// in order with any punctuation/whitespace between them — so "wow..you did it"
// lights up as one span. If the phrase isn't contiguous here (the AND-of-tokens
// fallback case), mark each token instead. Tokens are normalized (lowercase,
// alphanumeric) so the joined pattern needs no escaping.
function highlight(text: string, query: string): React.ReactNode {
  const toks = queryTokens(query);
  if (toks.length === 0) return text;

  let ranges: [number, number][] = [];
  const phraseRe = new RegExp(toks.join("[^a-z0-9]+"), "ig");
  for (let m = phraseRe.exec(text); m; m = phraseRe.exec(text)) {
    ranges.push([m.index, m.index + m[0].length]);
    if (m.index === phraseRe.lastIndex) phraseRe.lastIndex++; // guard zero-width
  }
  if (ranges.length === 0) {
    const lower = text.toLowerCase();
    for (const t of toks)
      for (let p = lower.indexOf(t); p !== -1; p = lower.indexOf(t, p + t.length))
        ranges.push([p, p + t.length]);
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    ranges = merged;
  }

  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (const [s, e] of ranges) {
    if (s > i) out.push(text.slice(i, s));
    out.push(
      <mark key={k++} className="rounded-sm bg-blue-500/30 px-0.5 text-zinc-100">
        {text.slice(s, e)}
      </mark>
    );
    i = e;
  }
  out.push(text.slice(i));
  return out;
}

// Sort-direction glyph (no icon lib in HQ): bars + an arrow that points down for
// newest-first (default) and up for oldest-first.
function SortIcon({ dir }: { dir: SortDir }) {
  const arrow =
    dir === "new" ? (
      <>
        <path d="M6 5v13" />
        <path d="m3 15 3 3 3-3" />
      </>
    ) : (
      <>
        <path d="M6 19V6" />
        <path d="m3 9 3-3 3 3" />
      </>
    );
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 6h9" />
      <path d="M12 11h6" />
      <path d="M12 16h3" />
      {arrow}
    </svg>
  );
}

// Universal search over everything HQ can see — transcripts, sessions, sdk runs,
// files, components, commits, todos, projects, memory, notes, scripts, skills.
// Result click opens the thing in-panel (read it where it lives).
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    scope?: string;
    sort?: string;
    open?: string;
    openSession?: string;
    openNote?: string;
    openScript?: string;
    openFile?: string;
    openComponent?: string;
    openCommit?: string;
    openTodo?: string;
    openProject?: string;
    openSkill?: string;
    openDoc?: string;
    session?: string;
    pair?: string;
  }>;
}) {
  const {
    q = "",
    scope: rawScope,
    sort: rawSort,
    open,
    openSession,
    openNote,
    openScript,
    openFile,
    openComponent,
    openCommit,
    openTodo,
    openProject,
    openSkill,
    openDoc,
    session,
    pair,
  } = await searchParams;
  const scope: SearchScope = SCOPES.some((s) => s.value === rawScope)
    ? (rawScope as SearchScope)
    : "all";
  const sortDir: SortDir = rawSort === "old" ? "old" : "new";
  // Carry the terminal pins on every in-panel nav. Dropping ?session/?pair
  // un-pins the terminal, which then self-re-pins via router.replace and wipes
  // the search query (q/scope/sort) — the "scope tab snaps back to All" bug.
  const tail = [session && `session=${session}`, pair && `pair=${pair}`]
    .filter(Boolean)
    .join("&");
  const pinTail = tail ? `&${tail}` : "";
  const back = `/search?q=${encodeURIComponent(q)}&scope=${scope}&sort=${sortDir}${pinTail}`;

  // Keep the offline docs mirror fresh (deduped, daily, out-of-process) — no-ops
  // while current; on first-ever load with no mirror it spawns the fetcher.
  warmDocs();

  // ── opened memory file ──────────────────────────────────────────────────
  if (open) {
    const content = getMemoryFile(open);
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <CopyText
            text={memoryFilePath(open)}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            memory/{open}
          </CopyText>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto text-sm">
          {content ? (
            <Markdown text={content} />
          ) : (
            <p className="text-xs text-zinc-600">memory file not found</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── opened transcript ───────────────────────────────────────────────────
  // The clicked transcript opens HERE (in the panel, like a memory note) rather
  // than hijacking the terminal. Clean user/assistant text only — no tool noise.
  if (openSession) {
    const { turns, project } = turnsFor(openSession, 250);
    // If the .jsonl is gone (Claude Code's 30-day sweep), fall back to the text
    // HQ retained in its search index — archived, flat, but not lost.
    const archived = turns.length === 0 ? retainedTranscriptText(openSession) : null;
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <CopyText
            text={`claude --resume ${openSession}`}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            {project || "session"} · {openSession.slice(0, 8)}
          </CopyText>
        </div>
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-sm">
          {turns.length === 0 ? (
            archived ? (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-amber-400">
                  archived · source transcript swept from disk
                </span>
                <div className="whitespace-pre-wrap text-zinc-300">{archived}</div>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">transcript not found</p>
            )
          ) : (
            turns.map((t, i) => (
              <div key={i} className="flex flex-col gap-1">
                <span
                  className={`font-mono text-[10px] uppercase tracking-wide ${
                    t.role === "user" ? "text-blue-400" : "text-emerald-400"
                  }`}
                >
                  {t.role === "user" ? "you" : "claude"}
                </span>
                <div className="text-zinc-300">
                  <Markdown text={t.text} />
                </div>
              </div>
            ))
          )}
        </div>
      </Boundary>
    );
  }

  // ── opened note ───────────────────────────────────────────────────────────
  if (openNote) {
    const content = getNoteFile(openNote);
    const body = content ? content.replace(/^---[\s\S]*?---\n/, "") : "";
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <span className="min-w-0 truncate font-mono text-xs text-zinc-500">
            note
          </span>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto text-sm">
          {content ? (
            <Markdown text={body} />
          ) : (
            <p className="text-xs text-zinc-600">note not found</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── opened script ─────────────────────────────────────────────────────────
  if (openScript) {
    const content = getScriptFile(openScript);
    return (
      <Boundary label="@panel/search/page.tsx">
        <div className="flex items-baseline gap-3">
          <Link
            href={back}
            scroll={false}
            className="shrink-0 font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            ← results
          </Link>
          <CopyText
            text={scriptFilePath(openScript)}
            className="min-w-0 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300"
          >
            scripts/{openScript}
          </CopyText>
        </div>
        <div className="scrollbar-none min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed text-zinc-300">
          {content ? (
            <pre className="whitespace-pre-wrap break-words">{content}</pre>
          ) : (
            <p className="text-xs text-zinc-600">script not found</p>
          )}
        </div>
      </Boundary>
    );
  }

  // ── opened file (Files corpus) ────────────────────────────────────────────
  if (openFile) {
    const content = getRepoFile(openFile);
    return (
      <ReaderShell back={back} label={openFile} copy={openFile}>
        {content ? (
          <pre className={CODE_BODY}>{content}</pre>
        ) : (
          <p className="text-xs text-zinc-600">file not found</p>
        )}
      </ReaderShell>
    );
  }

  // ── opened component source ───────────────────────────────────────────────
  if (openComponent) {
    const c = COMPONENTS.find((x) => x.name === openComponent);
    const content = c ? readComponentSource(c.file) : "";
    return (
      <ReaderShell back={back} label={c ? c.file : openComponent} copy={c?.file}>
        {content ? (
          <pre className={CODE_BODY}>{content}</pre>
        ) : (
          <p className="text-xs text-zinc-600">component source not found</p>
        )}
      </ReaderShell>
    );
  }

  // ── opened commit diff ────────────────────────────────────────────────────
  if (openCommit) {
    const slash = openCommit.indexOf("/");
    const repo = slash > 0 ? openCommit.slice(0, slash) : "";
    const sha = slash > 0 ? openCommit.slice(slash + 1) : "";
    const commit = repo && sha ? getCommit(repo, sha) : null;
    return (
      <ReaderShell
        back={back}
        label={`${repo} · ${sha.slice(0, 7)}`}
        copy={commit ? `git -C ~/code/${repo} show ${sha}` : undefined}
      >
        {commit ? (
          <pre className={CODE_BODY}>{commit.text}</pre>
        ) : (
          <p className="text-xs text-zinc-600">commit not found</p>
        )}
      </ReaderShell>
    );
  }

  // ── opened todo ───────────────────────────────────────────────────────────
  if (openTodo) {
    const t = getTodos().find((x) => x.id === openTodo);
    return (
      <ReaderShell back={back} label={`todo · ${openTodo}`} copy={openTodo}>
        {t ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium text-zinc-200">{t.text}</p>
            {t.body ? (
              <Markdown text={t.body} />
            ) : (
              <p className="text-xs text-zinc-600">no description</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">todo not found</p>
        )}
      </ReaderShell>
    );
  }

  // ── opened project (its sessions) ─────────────────────────────────────────
  if (openProject) {
    const rows = getProjectSessions(openProject);
    return (
      <ReaderShell back={back} label={`project · ${openProject}`}>
        <div className="flex flex-col gap-1.5">
          {rows.length === 0 ? (
            <p className="text-xs text-zinc-600">no sessions</p>
          ) : (
            rows.map((s) => (
              <Link
                key={s.id}
                href={`${back}&openSession=${s.id}`}
                scroll={false}
                className="flex items-baseline gap-2 rounded-md border border-zinc-800 px-2.5 py-1.5 transition-colors hover:border-zinc-600"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                  {s.customTitle || s.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                  {s.id.slice(0, 8)} · {ago(s.lastActive)}
                </span>
              </Link>
            ))
          )}
        </div>
      </ReaderShell>
    );
  }

  // ── opened skill (SKILL.md) ───────────────────────────────────────────────
  if (openSkill) {
    const content = readSkillDoc(openSkill);
    return (
      <ReaderShell back={back} label="skill" copy={openSkill}>
        {content ? (
          <div className="text-sm">
            <Markdown text={content} />
          </div>
        ) : (
          <p className="text-xs text-zinc-600">skill not found</p>
        )}
      </ReaderShell>
    );
  }

  // ── opened doc (Claude Code docs mirror) ──────────────────────────────────
  if (openDoc) {
    const content = readDoc(openDoc);
    return (
      <ReaderShell
        back={back}
        label={`docs/${openDoc}`}
        copy={`https://code.claude.com/docs/en/${openDoc}`}
      >
        {content ? (
          <div className="text-sm">
            <Markdown text={content} />
          </div>
        ) : (
          <p className="text-xs text-zinc-600">doc not found — try refreshing the mirror</p>
        )}
      </ReaderShell>
    );
  }

  // ── query + results ─────────────────────────────────────────────────────
  // No query → browse the most-recent transcripts + memory as cards (honors the
  // scope chips + sort toggle). With a query → ranked search hits.
  const { hits, building } = q
    ? search(q, scope, sortDir)
    : { hits: recent(scope, sortDir), building: false };

  return (
    <Boundary label="@panel/search/page.tsx">
      {/* Header mirrors the Components panel: search box on top, then a Filter
          dropdown (left, the 13 scopes as colored chips) + sort button (right).
          The active scope rides on the Filter face, so the old chip row is gone. */}
      <div className="flex flex-col gap-1.5">
        <SearchInput initial={q} scope={scope} sort={sortDir} pins={tail} />
        <div className="flex items-center gap-2">
          <SearchScopeFilter scope={scope} q={q} sort={sortDir} pins={tail} />
          <Link
            href={`/search?q=${encodeURIComponent(q)}&scope=${scope}&sort=${
              sortDir === "new" ? "old" : "new"
            }${pinTail}`}
            scroll={false}
            aria-label="Toggle sort order"
            title={
              sortDir === "new"
                ? "Newest first — click for oldest"
                : "Oldest first — click for newest"
            }
            className="ml-auto flex shrink-0 items-center rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <SortIcon dir={sortDir} />
          </Link>
        </div>
      </div>

      {!q && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
          recent
        </p>
      )}

      <ul className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
        {hits.map((h) => {
          // route each kind to its in-panel reader (session/sdk reuse the
          // transcript reader; project lists its sessions).
          const op =
            h.kind === "transcript" || h.kind === "session" || h.kind === "sdk"
              ? `openSession=${h.ref}`
              : h.kind === "note"
                ? `openNote=${encodeURIComponent(h.ref)}`
                : h.kind === "script"
                  ? `openScript=${encodeURIComponent(h.ref)}`
                  : h.kind === "memory"
                    ? `open=${encodeURIComponent(h.ref)}`
                    : h.kind === "file"
                      ? `openFile=${encodeURIComponent(h.ref)}`
                      : h.kind === "component"
                        ? `openComponent=${encodeURIComponent(h.ref)}`
                        : h.kind === "commit"
                          ? `openCommit=${encodeURIComponent(h.ref)}`
                          : h.kind === "todo"
                            ? `openTodo=${encodeURIComponent(h.ref)}`
                            : h.kind === "project"
                              ? `openProject=${encodeURIComponent(h.ref)}`
                              : h.kind === "skill"
                                ? `openSkill=${encodeURIComponent(h.ref)}`
                                : `openDoc=${encodeURIComponent(h.ref)}`;
          const href = `${back}&${op}`;
          // anything with a path drags into a terminal (drops the path)
          const drag =
            h.kind === "script"
              ? scriptFilePath(h.ref)
              : h.kind === "file" || h.kind === "component"
                ? h.path ?? null
                : null;
          const cardCls =
            "flex flex-col gap-1 rounded-md border border-zinc-800 px-3 py-2 transition-colors hover:border-zinc-600 hover:bg-zinc-900/50";
          const inner = (
            <>
              <div className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                  {h.title}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${KIND_TAG[h.kind]}`}
                >
                  {h.kind}
                </span>
              </div>
              {h.snippet && (
                <p className="break-words text-xs text-zinc-400">
                  {highlight(h.snippet, q)}
                </p>
              )}
              {/* footer — identity · descriptor · time, all at the bottom */}
              <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
                <span className="min-w-0 truncate">{footRef(h)}</span>
                {h.meta && <span className="shrink-0 text-zinc-500">{h.meta}</span>}
                <span className="ml-auto shrink-0">{ago(h.at)}</span>
              </div>
            </>
          );
          return (
            <li key={`${h.kind}:${h.ref}`}>
              {drag ? (
                // draggable into a terminal (drops the path) + click-to-open
                <DraggableCard href={href} drag={drag} className={cardCls}>
                  {inner}
                </DraggableCard>
              ) : (
                <Link href={href} scroll={false} className={cardCls}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
        {hits.length === 0 && (
          <li className="text-xs text-zinc-600">
            {building
              ? "building the search index (first time, ~10s)…"
              : q
                ? "no matches"
                : "nothing here yet"}
          </li>
        )}
      </ul>
      <p className="text-xs text-zinc-600">
        universal search — sessions · files · components · commits · todos ·
        memory · notes &amp; more · click a result to read it here
        {building && <span className="text-amber-400"> · indexing…</span>}
      </p>
      <RefreshWhile active={building} />
    </Boundary>
  );
}

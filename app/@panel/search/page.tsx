import Boundary from "@/app/ui/boundary";
import Link from "next/link";
import Markdown from "@/app/ui/md";
import SearchInput from "@/app/ui/search-input";
import RefreshWhile from "@/app/ui/refresh-while";
import CopyText from "@/app/ui/copy-text";
import ReaderActions from "@/app/ui/reader-actions";
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
import { CORPORA, type Corpus } from "@/app/ui/search-corpus";
import SearchCorpusRail from "@/app/ui/search-corpus-rail";
import SearchResultGroup from "@/app/ui/search-result-group";

// Shared chrome for the in-panel readers (file/component/commit/todo/project/
// skill/doc): the "← results" back link + a click-to-copy path header over a
// scroll body. The original memory/transcript/note/script readers predate this
// and keep their inline shells; new corpora share this one.
function ReaderShell({
  back,
  label,
  copy,
  actions,
  children,
}: {
  back: string;
  label: string;
  copy?: string;
  actions?: React.ReactNode; // floating reader-action cluster (pencil/copy), pinned top-right
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
      <div className="relative min-h-0 flex-1">
        {actions}
        <div className="scrollbar-none h-full overflow-auto">{children}</div>
      </div>
    </Boundary>
  );
}

// Source-code reader body (file / component source / commit diff) — wrapped mono.
const CODE_BODY =
  "whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300";

export const dynamic = "force-dynamic";

// Sort-direction glyph (no icon lib in HQ): bars + an arrow that points down for
// newest-first (default) and up for oldest-first.
function SortIcon({ dir }: { dir: SortDir }) {
  // "rel" = bars only (a ranked list, no chronological direction); "new"/"old" add
  // a down/up arrow.
  const arrow =
    dir === "rel" ? null : dir === "new" ? (
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
// files, components, commits, todos, projects, memory, notes, scripts, skills,
// docs. A query groups its hits PER corpus (Docs first); clicking a result opens
// the thing in-panel (read it where it lives).
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
  // Relevance is the default WHEN there's a query (you searched → best match first,
  // so the per-corpus score ranking surfaces); browsing (no query) defaults to
  // newest. An explicit ?sort always wins.
  const sortDir: SortDir =
    rawSort === "old" || rawSort === "new" || rawSort === "rel"
      ? (rawSort as SortDir)
      : q
        ? "rel"
        : "new";
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
        <div className="relative min-h-0 flex-1">
          <ReaderActions
            kind="memory"
            refId={open}
            title={`memory/${open}`}
            text={content ?? ""}
          />
          <div className="scrollbar-none h-full overflow-y-auto text-sm">
            {content ? (
              <Markdown text={content} />
            ) : (
              <p className="text-xs text-zinc-600">memory file not found</p>
            )}
          </div>
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
        <div className="relative min-h-0 flex-1">
          <ReaderActions
            kind="note"
            refId={openNote}
            title="note"
            text={body}
          />
          <div className="scrollbar-none h-full overflow-y-auto text-sm">
            {content ? (
              <Markdown text={body} />
            ) : (
              <p className="text-xs text-zinc-600">note not found</p>
            )}
          </div>
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
      <ReaderShell
        back={back}
        label={openFile}
        copy={openFile}
        actions={
          <ReaderActions
            kind="file"
            refId={openFile}
            title={openFile}
            text={content ?? ""}
          />
        }
      >
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

  // ── query + grouped results ───────────────────────────────────────────────
  // Per the brief: never let one corpus blank another, keep Docs first-class. So
  // the overview queries EACH corpus on its own (the global recency sort can't
  // crowd a low-volume corpus out) and stacks them in CORPORA order — Docs lead.
  // A scoped view drills into a single corpus at full depth. Per-corpus calls cost
  // ≈ one search("all") since each only searches its own corpus.
  const PER_CORPUS = 10;
  type Group = { corpus: Corpus; hits: SearchHit[]; count: string; drill?: string };
  const groups: Group[] = [];
  const counts: Record<string, string> = {};
  let building = false;

  if (!q) {
    // Empty → browse the most-recent cards (transcripts + memory), grouped by
    // corpus for consistency. The rail itself is the "hub" the eye lands on.
    const rec = recent(scope, sortDir);
    for (const c of CORPORA) {
      const hits = rec.filter((h) => h.kind === c.kind);
      if (hits.length) groups.push({ corpus: c, hits, count: "" });
    }
  } else if (scope === "all") {
    for (const c of CORPORA) {
      const { hits, building: b } = search(q, c.scope, sortDir, PER_CORPUS + 1);
      building ||= b;
      if (!hits.length) continue;
      const capped = hits.length > PER_CORPUS;
      const label = capped ? `${PER_CORPUS}+` : String(hits.length);
      counts[c.scope] = label;
      groups.push({
        corpus: c,
        hits: hits.slice(0, PER_CORPUS),
        count: label,
        drill: capped
          ? `/search?q=${encodeURIComponent(q)}&scope=${c.scope}&sort=${sortDir}${pinTail}`
          : undefined,
      });
    }
  } else {
    const c = CORPORA.find((x) => x.scope === scope);
    if (c) {
      const { hits, building: b } = search(q, scope, sortDir, 200);
      building = b;
      if (hits.length) {
        counts[c.scope] = String(hits.length);
        groups.push({ corpus: c, hits, count: String(hits.length) });
      }
    }
  }

  const summary = !q
    ? "recent"
    : scope === "all"
      ? `${groups.length} ${groups.length === 1 ? "corpus" : "corpora"}`
      : "";

  return (
    <Boundary label="@panel/search/page.tsx">
      <div className="flex flex-col gap-2">
        <SearchInput initial={q} scope={scope} sort={sortDir} pins={tail} />
        <div className="flex items-center gap-2 px-0.5">
          {summary && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
              {summary}
            </span>
          )}
          <Link
            href={`/search?q=${encodeURIComponent(q)}&scope=${scope}&sort=${
              sortDir === "rel" ? "new" : sortDir === "new" ? "old" : "rel"
            }${pinTail}`}
            scroll={false}
            aria-label="Toggle sort order"
            title={
              sortDir === "rel"
                ? "Most relevant — click for newest"
                : sortDir === "new"
                  ? "Newest first — click for oldest"
                  : "Oldest first — click for most relevant"
            }
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <SortIcon dir={sortDir} />
            <span>{sortDir === "rel" ? "relevant" : sortDir === "new" ? "newest" : "oldest"}</span>
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row sm:gap-4">
        <div className="scrollbar-none shrink-0 sm:w-36 sm:overflow-y-auto">
          <SearchCorpusRail
            active={scope}
            counts={counts}
            dimEmpty={!!q && scope === "all"}
            q={q}
            sort={sortDir}
            pins={tail}
          />
        </div>
        <div className="scrollbar-none flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
          {groups.map((g) => (
            <SearchResultGroup
              key={g.corpus.scope}
              corpus={g.corpus}
              hits={g.hits}
              q={q}
              back={back}
              count={g.count}
              drillHref={g.drill}
            />
          ))}
          {groups.length === 0 && (
            <p className="text-xs text-zinc-600">
              {building
                ? "building the search index (first time, ~10s)…"
                : q
                  ? "no matches"
                  : "nothing here yet"}
            </p>
          )}
        </div>
      </div>

      <p className="font-mono text-[10px] text-zinc-600">
        <span className="text-zinc-500">/</span> focus ·{" "}
        <span className="text-zinc-500">↵</span> open ·{" "}
        <span className="text-zinc-500">⎋</span> clear · click a result to read it here
        {building && <span className="text-amber-400"> · indexing…</span>}
      </p>
      <RefreshWhile active={building} />
    </Boundary>
  );
}

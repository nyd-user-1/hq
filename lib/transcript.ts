import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { liveSessionStatus, isLiveFresh } from "./session-status";

// Live view of the current Claude Code session: the newest transcript in
// ~/.claude/projects/<cwd-slug>/ is the active conversation. Read its tail,
// keep only real user/assistant text (no tool calls, no command wrappers).

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
// Last-resort path for a session id not found on disk. Claude Code encodes a
// cwd into its project-dir name by replacing path separators with "-"
// (/Users/jane → -Users-jane), so derive the current user's home slug instead
// of hardcoding one — otherwise HQ only works on the machine it was built on.
const SESSIONS_DIR = path.join(PROJECTS_ROOT, os.homedir().replace(/[/.]/g, "-"));
const TAIL_BYTES = 8 * 1024 * 1024;

export type Turn = { role: "user" | "assistant"; text: string; at: string };

// Every Claude Code transcript on the machine (across ALL project dirs), newest
// first. The terminal observes any session — not just home — so lookups must
// search every dir, matching what the Sessions list (lib/sessions.ts) shows.
type SessionRef = { id: string; file: string; mtime: number };
let sessionsCache: { at: number; list: SessionRef[] } | null = null;
const SESSIONS_TTL_MS = 1000;

function allSessions(): SessionRef[] {
  // The project-dir walk (readdir × N dirs + statSync per file) used to run on
  // EVERY reader call — several times per request, and on the always-open SSE
  // backstop. Memoize it for ~1s so concurrent callers share one walk. The live
  // byte-size signal that actually drives the pinned terminal is read FRESH in
  // streamSignature() (its own statSync), so this cache never adds latency to a
  // pinned session — it only collapses the redundant directory scans (PERF-1).
  const nowMs = Date.now();
  if (sessionsCache && nowMs - sessionsCache.at < SESSIONS_TTL_MS) return sessionsCache.list;
  const out: SessionRef[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        out.push({
          id: f.slice(0, -6),
          file: full,
          mtime: fs.statSync(full).mtimeMs,
        });
      } catch {
        // vanished mid-scan
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  sessionsCache = { at: nowMs, list: out };
  return out;
}

// Session ids are UUIDs (globally unique), so a single match across all dirs.
function findSessionFile(id: string): string | null {
  return allSessions().find((s) => s.id === id)?.file ?? null;
}

export function latestSessionId(): string | null {
  return allSessions()[0]?.id ?? null;
}

function blocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function clean(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

// Absolute path of a session's transcript — searched across ALL project dirs
// (the terminal observes any session). Falls back to the home dir for an
// unknown id.
export function sessionFilePath(id: string): string {
  // findSessionFile only returns real on-disk basenames. The fallback below is
  // the ONE place a raw id becomes a path, so basename() it — a crafted id like
  // `../../../etc/foo` collapses to a bare name inside SESSIONS_DIR and can't
  // escape (CODE-REVIEW SEC-3). A real UUID is unchanged by basename().
  return findSessionFile(id) ?? path.join(SESSIONS_DIR, `${path.basename(id)}.jsonl`);
}

// A cheap "did anything change" number the SSE stream polls. Pinned → the file's
// byte size (grows as the session is written). Unpinned → the newest mtime
// across all sessions, so it also fires when a send forks a new transcript or
// another terminal becomes the active session. -1 if unreadable.
export function streamSignature(pinned: string | null): number {
  try {
    if (pinned) {
      const f = findSessionFile(pinned);
      return f ? fs.statSync(f).size : -1;
    }
    return allSessions()[0]?.mtime ?? -1; // newest mtime across all dirs
  } catch {
    return -1;
  }
}

// Parse user/assistant turns out of a transcript-tail buffer. `partial` drops
// the first (truncated) line when reading from a mid-file byte offset. Merges
// consecutive same-role entries (streaming splits one reply across lines).
export function parseTurns(
  text: string,
  partial: boolean
): { turns: Turn[]; project: string } {
  const lines = text.split("\n");
  if (partial) lines.shift();
  const turns: Turn[] = [];
  let project = "";
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!project && typeof entry.cwd === "string")
      project = entry.cwd === os.homedir() ? "~" : path.basename(entry.cwd);
    if (entry.isSidechain) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const t = clean(blocksToText(entry.message?.content));
    if (!t) continue;
    if (t.includes("<command-name>") || t.includes("<local-command-stdout>"))
      continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === entry.type) prev.text += `\n\n${t}`;
    else turns.push({ role: entry.type, text: t, at: entry.timestamp ?? "" });
  }
  return { turns, project };
}

// Turns for a specific session (id = null → the newest session).
export function turnsFor(
  id: string | null,
  count: number
): { id: string | null; turns: Turn[]; project: string } {
  const sid = id ?? latestSessionId();
  if (!sid) return { id: null, turns: [], project: "" };
  let text: string;
  let partial = false;
  try {
    const file = sessionFilePath(sid);
    const size = fs.statSync(file).size;
    const startAt = Math.max(0, size - TAIL_BYTES);
    partial = startAt > 0;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return { id: sid, turns: [], project: "" };
  }
  const { turns, project } = parseTurns(text, partial);
  return { id: sid, turns: turns.slice(-count), project };
}

export function recentTurns(count: number): Turn[] {
  return turnsFor(null, count).turns;
}

// ── Timeline: text turns + tool steps interleaved ─────────────────────────────
// The terminal's full view. Unlike turnsFor (text only), this surfaces every
// tool_use as a step and attaches its tool_result output — the "what's Claude
// actually doing" stream (Edit diffs, Bash commands + output, Reads, Tasks).

export type TimelineItem =
  | {
      kind: "turn";
      role: "user" | "assistant";
      text: string;
      at: string;
      uuid?: string; // the source jsonl entry's uuid — a stable per-block key for HQ block-meta (favorite/hide/react)
      turnTokens?: number; // set on the LAST assistant card of a work block: the whole block's output-token burn
    }
  | { kind: "command"; command: string; arg: string; at: string } // local command marker (/clear, /model, …)
  | { kind: "handoff"; direction: "to-hq" | "to-terminal"; at: string } // HQ took/released the wheel (sidecar-sourced, merged in the turns route — transcript.ts never produces this)
  | {
      kind: "tool";
      id: string;
      tool: string; // "Edit", "Bash", "Read", …
      title: string; // file basename / command / pattern
      detail: string; // expand body: diff / command + output / input + output
      at: string;
      isError?: boolean;
      resultTokens?: number; // ~chars/4 of input + result, UNtruncated — the context cost
    };

function baseName(p: unknown): string {
  return typeof p === "string" ? p.split("/").pop() || p : "";
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) =>
        typeof b === "string" ? b : b?.type === "text" ? (b.text ?? "") : ""
      )
      .join("\n");
  return "";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toolTitle(name: string, input: any): string {
  switch (name) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read":
    case "NotebookEdit":
      return baseName(input?.file_path ?? input?.notebook_path) || name;
    case "Bash":
      return (input?.command ?? "").split("\n")[0].slice(0, 90);
    case "Grep":
    case "Glob":
      return input?.pattern ?? name;
    case "Task":
      return input?.description ?? input?.subagent_type ?? name;
    case "WebFetch":
      return input?.url ?? name;
    case "WebSearch":
      return input?.query ?? name;
    case "TodoWrite":
      return "todos";
    default: {
      const v = input && Object.values(input).find((x) => typeof x === "string");
      return typeof v === "string" ? v.slice(0, 90) : name;
    }
  }
}

function inputDetail(name: string, input: any): string {
  if (name === "Edit") {
    const o = String(input?.old_string ?? "")
      .split("\n")
      .map((l: string) => `- ${l}`)
      .join("\n");
    const n = String(input?.new_string ?? "")
      .split("\n")
      .map((l: string) => `+ ${l}`)
      .join("\n");
    return `${o}\n${n}`;
  }
  if (name === "Write")
    return `+ ${input?.file_path ?? ""}\n\n${input?.content ?? ""}`;
  if (name === "Bash") return `$ ${input?.command ?? ""}`;
  if (name === "Read") return String(input?.file_path ?? "");
  return input ? JSON.stringify(input, null, 2) : "";
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const trimDetail = (s: string) =>
  s.length > 4000 ? s.slice(0, 4000) + "\n…(truncated)" : s;

// Full-file parse is cached by (file, mtime) so scrollback (full=true) doesn't
// re-read the whole transcript on every poll — only when it actually changed.
type Timeline = {
  id: string | null;
  items: TimelineItem[];
  project: string;
  contextTokens: number; // context size = last assistant entry's input-only usage (matches the CLI)
  model: string; // raw model id of the latest assistant entry ("" if unknown)
  lastWrite: number; // transcript mtime ms — drives the cache-warm countdown
  more: boolean; // older items exist beyond what's returned (the tail was capped)
};
const fullTimelineCache = new Map<string, { mtime: number; result: Timeline }>();
// PERF-2: the polled (non-full) tail path was NOT cached — it re-read + re-parsed
// the 8MB tail on every 1s poll. Keyed by `${file}:${count}` → the tail content
// (append-only ⇒ size identifies it). workingStatus (the live "now") is computed
// separately by the route, so this content-only result is safe to cache.
const tailTimelineCache = new Map<string, { size: number; result: Timeline }>();

export function timelineFor(
  id: string | null,
  count: number,
  // full → read the WHOLE file (scrollback) instead of the last TAIL_BYTES and
  // return every item; cached by mtime so repeated/polled reads cost nothing.
  full = false
): Timeline {
  const sid = id ?? latestSessionId();
  if (!sid)
    return { id: null, items: [], project: "", contextTokens: 0, model: "", lastWrite: 0, more: false };
  let text: string;
  let partial = false;
  let lastWrite = 0;
  const file = sessionFilePath(sid);
  let size = 0;
  const tkey = `${file}:${count}`;
  try {
    const st = fs.statSync(file);
    lastWrite = st.mtimeMs;
    size = st.size;
    if (full) {
      const cached = fullTimelineCache.get(file);
      if (cached && cached.mtime === st.mtimeMs) return cached.result;
    } else {
      const cached = tailTimelineCache.get(tkey); // PERF-2: skip re-parse when unchanged
      if (cached && cached.size === st.size) return cached.result;
    }
    const startAt = full ? 0 : Math.max(0, st.size - TAIL_BYTES);
    partial = startAt > 0;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return { id: sid, items: [], project: "", contextTokens: 0, model: "", lastWrite: 0, more: false };
  }

  const lines = text.split("\n");
  if (partial) lines.shift();

  const items: TimelineItem[] = [];
  type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
  type TurnItem = Extract<TimelineItem, { kind: "turn" }>;
  const toolById = new Map<string, ToolItem>();
  let project = "";
  let contextTokens = 0;
  let model = ""; // raw model id — last assistant entry wins (current model)

  // Per-block token burn: a block runs from one user prompt to the next. Output
  // tokens accumulate per API message id (max per id, summed — same math as
  // workingStatus); the total is stamped on the block's last assistant card.
  let blockTokens = new Map<string, number>();
  let lastReply: TurnItem | null = null;
  const closeBlock = () => {
    if (lastReply) {
      let t = 0;
      for (const v of blockTokens.values()) t += v;
      if (t > 0) lastReply.turnTokens = t;
    }
    blockTokens = new Map();
    lastReply = null;
  };

  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!project && typeof e.cwd === "string")
      project = e.cwd === os.homedir() ? "~" : path.basename(e.cwd);
    if (e.isSidechain) continue;
    if (e.type !== "user" && e.type !== "assistant") continue;
    const c = e.message?.content;
    const at = e.timestamp ?? "";

    if (e.type === "assistant") {
      if (typeof e.message?.model === "string") model = e.message.model;
      const u = e.message?.usage;
      if (u)
        // Input-only (input + cache read + cache write) — matches the CLI's
        // context readout and the statusline `used_percentage`. This turn's
        // output tokens aren't part of the live window (they roll into NEXT
        // turn's input), so including them over-read the % vs the CLI.
        contextTokens =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
      const mid = e.message?.id;
      if (mid)
        blockTokens.set(
          mid,
          Math.max(blockTokens.get(mid) ?? 0, u?.output_tokens ?? 0)
        );
      const blocks = Array.isArray(c) ? c : [];
      for (const b of blocks) {
        if (b?.type === "text" && (b.text ?? "").trim()) {
          const prev = items[items.length - 1];
          if (prev && prev.kind === "turn" && prev.role === "assistant") {
            prev.text += `\n${b.text}`;
            lastReply = prev;
          } else {
            const reply: TurnItem = {
              kind: "turn",
              role: "assistant",
              text: b.text,
              at,
              uuid: e.uuid,
            };
            items.push(reply);
            lastReply = reply;
          }
        } else if (b?.type === "tool_use") {
          const input = inputDetail(b.name, b.input);
          const step: ToolItem = {
            kind: "tool",
            id: b.id ?? `t${items.length}`,
            tool: b.name ?? "tool",
            title: toolTitle(b.name, b.input),
            detail: trimDetail(input),
            at,
            resultTokens: Math.round(input.length / 4),
          };
          items.push(step);
          if (b.id) toolById.set(b.id, step);
        }
      }
    } else {
      const blocks = Array.isArray(c) ? c : [];
      const tr = blocks.find((b) => b?.type === "tool_result");
      if (tr) {
        const step = tr.tool_use_id ? toolById.get(tr.tool_use_id) : undefined;
        if (step) {
          const out = resultText(tr.content).trim();
          step.resultTokens =
            (step.resultTokens ?? 0) + Math.round(out.length / 4);
          // Edit/Write/TodoWrite outputs are just confirmations — keep the diff.
          if (out && !["Edit", "Write", "TodoWrite"].includes(step.tool))
            step.detail = trimDetail(`${step.detail}\n\n${out}`);
          if (tr.is_error) step.isError = true;
        }
        continue;
      }
      const raw = typeof c === "string" ? c : blocksToText(c);
      // Local commands (/clear, /model, …) show as dim markers — the user's own
      // action reflected back, instead of a silently blank timeline.
      const cmd = raw.match(/<command-name>([^<]*)<\/command-name>/);
      if (cmd) {
        const arg =
          raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim() ??
          "";
        items.push({ kind: "command", command: cmd[1].trim(), arg, at });
        continue;
      }
      if (raw.includes("<local-command-stdout>")) continue;
      const t = clean(raw);
      if (!t) continue;
      closeBlock(); // a new prompt ends the previous work block
      items.push({ kind: "turn", role: "user", text: t, at, uuid: e.uuid });
    }
  }

  closeBlock(); // stamp the final (possibly in-flight) block
  const result: Timeline = {
    id: sid,
    items: full ? items : items.slice(-count),
    project,
    contextTokens,
    model,
    lastWrite,
    more: !full && (partial || items.length > count),
  };
  if (full && lastWrite)
    fullTimelineCache.set(file, { mtime: lastWrite, result });
  else if (!full) tailTimelineCache.set(tkey, { size, result }); // PERF-2
  return result;
}

export type WorkingStatus = {
  startedAt: number; // ms — turn start (the last real user prompt)
  outputTokens: number; // accumulating output tokens for the in-flight turn
  phase: string; // current: "thinking" | "writing" | "using <tool>"
  phases: string[]; // the progression so far: thinking → Bash → Read → writing …
};

// Is a session mid-turn right now, and if so, what's it doing? Inferred from the
// live transcript: a user prompt with no assistant reply = thinking; an
// assistant entry whose stop_reason is null/"tool_use" = still generating /
// running a tool; "end_turn" = done. Output tokens come from the in-flight
// assistant entry's usage. Powers the terminal's live "working" status line.
export function workingStatus(id: string | null): WorkingStatus | null {
  const sid = id ?? latestSessionId();
  if (!sid) return null;
  // AUTHORITATIVE cross-check: Claude Code's own ~/.claude/sessions/<pid>.json.
  // When the live record is fresh and says "idle", the session is NOT working —
  // trust it over any inference (kills the false "still churning" after a quiet
  // finish). When it says "busy", we use statusUpdatedAt as the true turn-start
  // below and skip the transcript-mtime staleness backstop.
  const now = Date.now();
  const live = liveSessionStatus(sid);
  const liveFresh = isLiveFresh(live, now);
  if (liveFresh && live!.status !== "busy") return null;
  let text: string;
  let partial = false;
  let mtime = 0;
  try {
    const file = sessionFilePath(sid);
    const st = fs.statSync(file);
    mtime = st.mtimeMs;
    const startAt = Math.max(0, st.size - TAIL_BYTES);
    partial = startAt > 0;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return null;
  }

  const lines = text.split("\n");
  if (partial) lines.shift();

  // Map a content block to a phase token: thinking / writing / tool:<Name>.
  const blockPhase = (b: { type?: string; name?: string }): string =>
    b?.type === "tool_use"
      ? `tool:${b.name}`
      : b?.type === "thinking"
        ? "thinking"
        : b?.type === "text"
          ? "writing"
          : "";

  type E = {
    role: "user" | "assistant";
    ts: number;
    isUserPrompt: boolean;
    isToolResult: boolean; // mid-turn tool result — proof a turn is in flight
    isInterrupt: boolean; // "[Request interrupted by user]" — ENDS a turn, doesn't start one
    stop: string | null;
    out: number;
    mid: string | null; // API message id — output_tokens accumulates per id
    phases: string[];
  };
  const entries: E[] = [];
  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain) continue;
    if (e.type !== "user" && e.type !== "assistant") continue;
    const c = e.message?.content;
    const blocks = Array.isArray(c) ? c : [];
    const isToolResult =
      e.type === "user" && blocks.some((b) => b?.type === "tool_result");
    const hasText =
      (typeof c === "string" && c.trim().length > 0) ||
      blocks.some((b) => b?.type === "text" && (b.text ?? "").trim().length > 0);
    const isMeta =
      typeof c === "string" &&
      (c.includes("<command-name>") ||
        c.includes("<local-command-stdout>") ||
        c.includes("<local-command-caveat>"));
    const flatText =
      typeof c === "string"
        ? c
        : blocks
            .filter((b) => b?.type === "text")
            .map((b) => b.text ?? "")
            .join(" ");
    const ts = Date.parse(e.timestamp);
    entries.push({
      role: e.type,
      ts: Number.isNaN(ts) ? 0 : ts,
      isUserPrompt: e.type === "user" && !isToolResult && hasText && !isMeta,
      isToolResult,
      isInterrupt: flatText.includes("[Request interrupted by user]"),
      stop: e.message?.stop_reason ?? null,
      out: e.message?.usage?.output_tokens ?? 0,
      mid: e.message?.id ?? null,
      phases: blocks.map(blockPhase).filter(Boolean),
    });
  }
  if (entries.length === 0) return null;

  let startIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].isUserPrompt) {
      startIdx = i;
      break;
    }
  }
  // Turn-start clock. Prefer the authoritative statusUpdatedAt when Claude Code
  // reports this session busy: it marks when the CLI ENTERED busy (= the current
  // turn start), far more reliable than inferring from the tail, which can latch
  // onto a stale prompt and show a 60-min elapsed for a turn that began seconds
  // ago (the "Churning 61m" freeze). Fall back to the inferred prompt timestamp.
  const startedAt =
    liveFresh && live!.status === "busy" && live!.statusUpdatedAt
      ? live!.statusUpdatedAt
      : entries[startIdx >= 0 ? startIdx : entries.length - 1].ts;

  // Token total: one turn spans MANY API calls (each tool result starts a new
  // one, whose output_tokens counter resets). The counter accumulates across
  // entries WITHIN a call (same message id) — so take the max per id, then sum
  // across ids. Matches the CLI's running ticker, modulo flush lag.
  const outByMsg = new Map<string, number>();
  const seq: string[] = [];
  for (let i = Math.max(0, startIdx); i < entries.length; i++) {
    if (entries[i].role !== "assistant") continue;
    const k = entries[i].mid ?? `#${i}`;
    outByMsg.set(k, Math.max(outByMsg.get(k) ?? 0, entries[i].out));
    for (const p of entries[i].phases) {
      const human = p.startsWith("tool:") ? p.slice(5) : p;
      if (seq[seq.length - 1] !== human) seq.push(human);
    }
  }
  let outputTokens = 0;
  for (const v of outByMsg.values()) outputTokens += v;

  const last = entries[entries.length - 1];
  const lastBlock = last.phases[last.phases.length - 1] ?? "";
  let working: boolean;
  let phase = "thinking";
  if (last.role === "user") {
    // A mid-turn tool result OR a real trailing prompt = a turn in flight. The CLI
    // does NOT flush the assistant entry (thinking blocks + tokens) until thinking
    // ENDS — often 30s–2min on high effort — so during thinking the last entry IS
    // the prompt. Treat that as "thinking" so HQ mirrors the CLI's spinner instead
    // of falsely reading "idle". The interrupt marker ENDS a turn (excluded), and a
    // genuinely abandoned/dead prompt is dropped by the 5-min staleness backstop.
    working = last.isToolResult || (last.isUserPrompt && !last.isInterrupt);
  } else if (
    last.stop === "end_turn" ||
    last.stop === "stop_sequence" ||
    last.stop === "max_tokens"
  ) {
    working = false;
  } else {
    working = true; // stop null or "tool_use"
    phase = lastBlock.startsWith("tool:")
      ? `using ${lastBlock.slice(5)}`
      : lastBlock === "thinking"
        ? "thinking"
        : "writing";
  }

  // Staleness backstop: a turn untouched for 5 min is almost certainly abandoned
  // — UNLESS the authoritative live record says this session is still busy (a long
  // thinking block leaves status busy while the transcript goes untouched for
  // minutes; killing it there is exactly the false-idle we want to avoid).
  if (working && now - mtime > 300_000 && !(liveFresh && live!.status === "busy"))
    working = false;
  if (!working) return null;

  return { startedAt, outputTokens, phase, phases: seq };
}

// Did this session's MOST RECENT turn end on a hard interrupt ("[Request
// interrupted by user]") with no newer prompt since? Powers the terminal's red
// "interrupted — awaiting new direction" border. workingStatus() returns null on
// both a clean finish and an interrupt, so this is the separate signal that tells
// them apart. Reads only the tail (cheap). False while a turn is in flight or
// after a normal completion; true only when the latest turn boundary is the
// interrupt marker — which clears the moment a fresh prompt lands.
export function lastTurnInterrupted(id: string | null): boolean {
  const sid = id ?? latestSessionId();
  if (!sid) return false;
  let text: string;
  try {
    const file = sessionFilePath(sid);
    const st = fs.statSync(file);
    const startAt = Math.max(0, st.size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return false;
  }
  const lines = text.split("\n");
  // Walk back to the most recent MEANINGFUL turn boundary and ask: was it the
  // interrupt marker? Skip sidechains, local-command meta, and mid-turn tool
  // results (a trailing tool_result means a turn is still live → not interrupted).
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain) continue;
    if (e.type !== "user" && e.type !== "assistant") continue;
    const c = e.message?.content;
    if (
      typeof c === "string" &&
      (c.includes("<command-name>") ||
        c.includes("<local-command-stdout>") ||
        c.includes("<local-command-caveat>"))
    )
      continue; // meta record
    const blocks = Array.isArray(c) ? c : [];
    if (e.type === "user" && blocks.some((b) => b?.type === "tool_result"))
      return false; // mid-turn tool result → a turn is in flight, not interrupted
    if (e.type === "assistant") return false; // a real reply → completed, not interrupted
    const flatText =
      typeof c === "string"
        ? c
        : blocks
            .filter((b) => b?.type === "text")
            .map((b) => b.text ?? "")
            .join(" ");
    return flatText.includes("[Request interrupted by user]");
  }
  return false;
}

// ── Divergence net: a rival branch in the same transcript ─────────────────────
// HQ's warm repl drives a session by `--resume`-ing INTO its <id>.jsonl. If a
// TUI process is ALSO still open on that same session and the user types there,
// the CLI writes a divergent leaf into the very same file — a real fork in the
// transcript tree. This detects that: a leaf that is NOT a descendant of HQ's
// own newest write AND is newer than it. RECON ONLY — never edits the .jsonl.
//
// Why each guard is correctness-critical (all verified against real on-disk
// transcripts): (1) DESCENDANT, not parentUuid-equality — one HQ turn spans many
// consecutive uuids sharing a message.id, so a parent-equality test self-flags HQ
// mid-stream; isAncestor(knownLeaf, L) makes every HQ continuation benign.
// (2) RECENCY is required — a transcript holds many stale abandoned leaves (24+
// pre-takeover `cli` branches in one real file); without `L.timestamp >
// knownLeaf.timestamp` the predicate cries wolf on every dead branch. (3)
// entrypoint is a CONFIRMING/labeling signal, not a hard AND-filter — a rival
// authored by ANOTHER sdk-cli process (a stray `claude -p` / a second HQ) is
// still a rival; gating on entrypoint would blind-spot it.
export type RivalBranch = {
  diverged: boolean;
  rivalLeafUuid?: string;
  rivalPreview?: string;
  rivalEntrypoint?: string;
};
type SpineRec = {
  uuid: string;
  parentUuid: string | null;
  type: string;
  entrypoint?: string;
  timestamp: string;
  text: string;
};
export function detectRivalBranch(
  id: string | null,
  knownLeafUuid?: string,
): RivalBranch {
  const sid = id ?? latestSessionId();
  if (!sid) return { diverged: false };
  let text: string;
  try {
    const file = sessionFilePath(sid);
    const st = fs.statSync(file);
    const startAt = Math.max(0, st.size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return { diverged: false };
  }
  // Spine parse: keep only records carrying BOTH uuid and parentUuid (the tree
  // backbone — user/assistant/attachment/system). Non-spine metadata records
  // (last-prompt, mode, ai-title, file-history-snapshot, the leading summary
  // record) have no uuid and must be ignored. Skip sidechains (Task sub-agents).
  const lines = text.split("\n");
  const byUuid = new Map<string, SpineRec>();
  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.isSidechain) continue;
    if (typeof e.uuid !== "string" || e.parentUuid === undefined) continue;
    byUuid.set(e.uuid, {
      uuid: e.uuid,
      parentUuid: e.parentUuid ?? null,
      type: e.type,
      entrypoint: e.entrypoint,
      timestamp: e.timestamp ?? "",
      text: blocksToText(e.message?.content),
    });
  }
  if (byUuid.size === 0) return { diverged: false };
  // Leaves = uuids that are never any record's parentUuid (the tips of the tree).
  const parents = new Set<string>();
  for (const r of byUuid.values()) if (r.parentUuid) parents.add(r.parentUuid);
  const leaves: SpineRec[] = [];
  for (const r of byUuid.values()) if (!parents.has(r.uuid)) leaves.push(r);
  // knownLeaf = HQ's own newest write. Caller-supplied (must be present in the
  // tail) wins; otherwise the transcript-derived default — the newest sdk-cli
  // record (the repl spawns `claude -p` stream-json, entrypoint='sdk-cli').
  // Assumes HQ is the only sdk-cli writer (true in single-HQ use). Before HQ's
  // first sdk-cli write (resumed a cli session, no turn sent) there's none → no
  // detection yet, which is correct: nothing for HQ to defend.
  let known: SpineRec | undefined =
    knownLeafUuid && byUuid.has(knownLeafUuid)
      ? byUuid.get(knownLeafUuid)
      : undefined;
  if (!known) {
    for (const r of byUuid.values()) {
      if (r.entrypoint !== "sdk-cli") continue;
      if (!known || r.timestamp > known.timestamp) known = r;
    }
  }
  if (!known) return { diverged: false };
  const knownLeaf = known;
  // isAncestor: walk L's parent chain (cycle-guarded); does it pass through anc?
  const isAncestor = (anc: string, leaf: SpineRec): boolean => {
    let cur: string | null = leaf.uuid;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === anc) return true;
      seen.add(cur);
      cur = byUuid.get(cur)?.parentUuid ?? null;
    }
    return false;
  };
  // A rival is a leaf that does NOT extend HQ's leaf and is newer than it. Pick
  // the newest such leaf. A leaf whose ancestor line fell outside the tail looks
  // rootless — the recency gate already suppresses it unless it's genuinely newer
  // than knownLeaf, and the client latch never auto-clears, so a truncated
  // ancestor can't be misread into a false all-clear.
  let rival: SpineRec | null = null;
  for (const L of leaves) {
    if (L.uuid === knownLeaf.uuid) continue;
    if (isAncestor(knownLeaf.uuid, L)) continue; // HQ's own continuation → benign
    if (L.timestamp <= knownLeaf.timestamp) continue; // stale/pre-takeover branch
    if (!rival || L.timestamp > rival.timestamp) rival = L;
  }
  if (!rival) return { diverged: false };
  // Preview: the nearest text-bearing node from the rival leaf upward (a leaf is
  // often a bare user turn or a tool_result with no reply yet).
  let preview = "";
  {
    let cur: string | null = rival.uuid;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      const r = byUuid.get(cur);
      const t = r?.text.trim();
      if (t) {
        preview = t.slice(0, 200);
        break;
      }
      seen.add(cur);
      cur = r?.parentUuid ?? null;
    }
  }
  return {
    diverged: true,
    rivalLeafUuid: rival.uuid,
    rivalPreview: preview || undefined,
    rivalEntrypoint: rival.entrypoint,
  };
}

// The working directory a session belongs to (its project root), read from the
// transcript's `cwd` field. `claude --resume <id>` resolves a conversation
// RELATIVE TO THE CURRENT PROJECT, so a headless resume must run from here — not
// $HOME — or it reports "No conversation found". Reads the tail and takes the
// most recent cwd (sessions rarely move, but the latest is the truth).
export function sessionCwd(id: string | null): string | null {
  const sid = id ?? latestSessionId();
  if (!sid) return null;
  let text: string;
  try {
    const file = sessionFilePath(sid);
    const st = fs.statSync(file);
    const startAt = Math.max(0, st.size - TAIL_BYTES);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return null;
  }
  for (const line of text.split("\n").reverse()) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e.cwd === "string" && e.cwd) return e.cwd;
    } catch {
      // partial/garbled tail line — keep walking back
    }
  }
  return null;
}

export type CommandRun = {
  command: string; // "/code-review"
  arg: string; // trailing args, if any
  at: string;
  project: string;
};

// Recent Runs: slash-command invocations across the newest transcripts, both
// forms — interactive <command-name>/foo</command-name> and the headless
// `claude -p /foo` fires the skill/bucket buttons send. Machine-wide, newest first.
export function recentCommands(limit = 8): CommandRun[] {
  const files: { file: string; mtime: number }[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        files.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      } catch {
        // vanished mid-scan
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const runs: CommandRun[] = [];
  // Scan at least `limit` files, not a hardcoded 8 — else recentCommands(20)
  // could never surface 20 (CODE-REVIEW BUG-7).
  for (const { file } of files.slice(0, Math.max(8, limit))) {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - 128 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();

    let project = "";
    for (const line of lines) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (!project && typeof e.cwd === "string")
        project = e.cwd === os.homedir() ? "~" : path.basename(e.cwd);
      if (e.type !== "user" || e.isSidechain) continue;
      const raw = blocksToText(e.message?.content);
      if (!raw) continue;
      const tag = raw.match(/<command-name>\s*\/?([\w-]+)\s*<\/command-name>/);
      const bare = clean(raw).match(/^\/([\w-]+)(?:\s+([\s\S]+))?$/);
      const m = tag ? { name: tag[1], arg: "" } : bare ? { name: bare[1], arg: bare[2] ?? "" } : null;
      if (!m) continue;
      runs.push({
        command: `/${m.name}`,
        arg: m.arg.replace(/\s+/g, " ").trim().slice(0, 60),
        at: e.timestamp ?? "",
        project,
      });
    }
  }
  return runs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

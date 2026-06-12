import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Live view of the current Claude Code session: the newest transcript in
// ~/.claude/projects/<cwd-slug>/ is the active conversation. Read its tail,
// keep only real user/assistant text (no tool calls, no command wrappers).

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const SESSIONS_DIR = path.join(PROJECTS_ROOT, "-Users-brendanstanton");
const TAIL_BYTES = 8 * 1024 * 1024;

export type Turn = { role: "user" | "assistant"; text: string; at: string };

// Every Claude Code transcript on the machine (across ALL project dirs), newest
// first. The terminal observes any session — not just home — so lookups must
// search every dir, matching what the Sessions list (lib/sessions.ts) shows.
function allSessions(): { id: string; file: string; mtime: number }[] {
  const out: { id: string; file: string; mtime: number }[] = [];
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
  return out.sort((a, b) => b.mtime - a.mtime);
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
  return findSessionFile(id) ?? path.join(SESSIONS_DIR, `${id}.jsonl`);
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
  | { kind: "turn"; role: "user" | "assistant"; text: string; at: string }
  | { kind: "command"; command: string; arg: string; at: string } // local command marker (/clear, /model, …)
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

export function timelineFor(
  id: string | null,
  count: number
): {
  id: string | null;
  items: TimelineItem[];
  project: string;
  contextTokens: number; // current context size = the last assistant entry's full usage
  lastWrite: number; // transcript mtime ms — drives the cache-warm countdown
} {
  const sid = id ?? latestSessionId();
  if (!sid)
    return { id: null, items: [], project: "", contextTokens: 0, lastWrite: 0 };
  let text: string;
  let partial = false;
  let lastWrite = 0;
  try {
    const file = sessionFilePath(sid);
    const st = fs.statSync(file);
    lastWrite = st.mtimeMs;
    const startAt = Math.max(0, st.size - TAIL_BYTES);
    partial = startAt > 0;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - startAt);
    fs.readSync(fd, buf, 0, buf.length, startAt);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return { id: sid, items: [], project: "", contextTokens: 0, lastWrite: 0 };
  }

  const lines = text.split("\n");
  if (partial) lines.shift();

  const items: TimelineItem[] = [];
  type ToolItem = Extract<TimelineItem, { kind: "tool" }>;
  const toolById = new Map<string, ToolItem>();
  let project = "";
  let contextTokens = 0;

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
      const u = e.message?.usage;
      if (u)
        contextTokens =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0) +
          (u.output_tokens ?? 0);
      const blocks = Array.isArray(c) ? c : [];
      for (const b of blocks) {
        if (b?.type === "text" && (b.text ?? "").trim()) {
          const prev = items[items.length - 1];
          if (prev && prev.kind === "turn" && prev.role === "assistant")
            prev.text += `\n${b.text}`;
          else items.push({ kind: "turn", role: "assistant", text: b.text, at });
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
      items.push({ kind: "turn", role: "user", text: t, at });
    }
  }

  return { id: sid, items: items.slice(-count), project, contextTokens, lastWrite };
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
    stop: string | null;
    out: number;
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
    const ts = Date.parse(e.timestamp);
    entries.push({
      role: e.type,
      ts: Number.isNaN(ts) ? 0 : ts,
      isUserPrompt: e.type === "user" && !isToolResult && hasText && !isMeta,
      isToolResult,
      stop: e.message?.stop_reason ?? null,
      out: e.message?.usage?.output_tokens ?? 0,
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
  const startedAt = entries[startIdx >= 0 ? startIdx : entries.length - 1].ts;

  // Token total + the phase progression across this turn's assistant entries.
  let outputTokens = 0;
  const seq: string[] = [];
  for (let i = Math.max(0, startIdx); i < entries.length; i++) {
    if (entries[i].role !== "assistant") continue;
    outputTokens = Math.max(outputTokens, entries[i].out);
    for (const p of entries[i].phases) {
      const human = p.startsWith("tool:") ? p.slice(5) : p;
      if (seq[seq.length - 1] !== human) seq.push(human);
    }
  }

  const last = entries[entries.length - 1];
  const lastBlock = last.phases[last.phases.length - 1] ?? "";
  let working: boolean;
  let phase = "thinking";
  if (last.role === "user") {
    // Only a mid-turn tool result PROVES a turn is in flight. A plain trailing
    // prompt may never run (interrupt, /clear record, abandoned message) —
    // claiming "thinking" for it is a lie the user can't disprove. Stay idle
    // until assistant blocks actually appear in the transcript.
    working = last.isToolResult;
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

  // Staleness backstop: a turn untouched for 5 min is almost certainly abandoned.
  if (working && Date.now() - mtime > 300_000) working = false;
  if (!working) return null;

  return { startedAt, outputTokens, phase, phases: seq };
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
  for (const { file } of files.slice(0, 8)) {
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

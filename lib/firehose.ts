import fs from "node:fs";
import { sessionFilePath, latestSessionId } from "./transcript";
import { sessionMeta } from "./sessions";

// FIREHOSE (in-panel) — the faithful everything-view of a session transcript as
// structured items, the dashboard sibling of scripts/firehose.mjs. Raw fields,
// nothing computed (raw token counts, no dollar estimate). See that script for
// where each field comes from on disk.

const TAIL_BYTES = 2 * 1024 * 1024; // read the tail; older history scrolls off
const CAP = 60; // max lines kept per block (display only; the drop is flagged)
const ITEM_CAP = 600; // keep the newest N items so the panel DOM stays bounded

export type Tone = "add" | "del" | "ctx" | "dim" | "err";
export type Line = { text: string; tone?: Tone; n?: number };

export type FireItem =
  | { t: "meta"; text: string } // provenance change / sidechain
  | { t: "branch"; text: string } // DAG rewind / interruption
  | { t: "user"; at: string; tag: string; cmd?: string; text: string; reminders: number; images?: string }
  | { t: "assistant"; at: string; sub: string } // "model · req · stop"
  | { t: "thinking"; text: string } // "SEALED · signature … (N chars)"
  | { t: "text"; text: string } // assistant prose
  | { t: "tool"; name: string; id: string; lines: Line[]; more: number }
  | { t: "diff"; head: string; added: number; removed: number; rows: Line[]; more: number; note?: string }
  | { t: "result"; head: string; rows: Line[]; more: number }
  | { t: "usage"; main: string; sub?: string; ms?: number }
  | { t: "system"; head: string; body?: string }
  | { t: "note"; icon: string; text: string }; // housekeeping one-liners

const short = (u: unknown) => (u ? String(u).replace(/^req_/, "").slice(0, 8) : "");

function capBlock(text: string, tone: Tone, prefix = ""): { rows: Line[]; more: number } {
  const all = String(text).replace(/\r/g, "").split("\n");
  const rows = all.slice(0, CAP).map((l) => ({ text: prefix + l, tone }));
  return { rows, more: Math.max(0, all.length - CAP) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toolLines(name: string, input: any): { lines: Line[]; more: number } {
  const i = input ?? {};
  const lines: Line[] = [];
  let more = 0;
  const add = (text: string, tone: Tone = "dim") => lines.push({ text, tone });
  const block = (text: string, tone: Tone, prefix: string) => {
    const c = capBlock(text, tone, prefix);
    lines.push(...c.rows);
    more += c.more;
  };
  if (i.command != null) block(i.command, "dim", "$ ");
  if (i.file_path != null) add(`file_path: ${i.file_path}`);
  if (i.path != null && i.file_path == null) add(`path: ${i.path}`);
  if (i.pattern != null) add(`pattern: ${i.pattern}`);
  if (i.glob != null) add(`glob: ${i.glob}`);
  if (i.offset != null || i.limit != null) add(`range: offset ${i.offset ?? "-"} · limit ${i.limit ?? "-"}`);
  if (i.old_string != null) { add("old_string:"); block(i.old_string, "del", "- "); }
  if (i.new_string != null) { add("new_string:"); block(i.new_string, "add", "+ "); }
  if (i.content != null && i.file_path != null) { add(`content (${String(i.content).length} chars):`); block(i.content, "dim", "| "); }
  if (i.replace_all) add("replace_all: true");
  if (i.description != null) add(`description: ${i.description}`);
  if (i.prompt != null) { add("prompt:"); block(i.prompt, "dim", ""); }
  if (i.todos != null) { add("todos:"); block(JSON.stringify(i.todos, null, 2), "dim", ""); }
  return { lines, more };
}

function diffItem(tur: any): FireItem | null {
  const patch = tur?.structuredPatch;
  if (!Array.isArray(patch) || patch.length === 0) return null;
  const name = String(tur.filePath || "").split("/").pop() || "";
  let added = 0, removed = 0;
  const rows: Line[] = [];
  let more = 0;
  for (let hi = 0; hi < patch.length; hi++) {
    const h = patch[hi];
    if (hi > 0) rows.push({ text: "⋯", tone: "dim" });
    let oldN = h.oldStart, newN = h.newStart;
    for (const ln of h.lines as string[]) {
      const sign = ln[0], body = ln.slice(1);
      if (sign === "+") { added++; if (rows.length < CAP * 2) rows.push({ text: body, tone: "add", n: newN }); else more++; newN++; }
      else if (sign === "-") { removed++; if (rows.length < CAP * 2) rows.push({ text: body, tone: "del", n: oldN }); else more++; oldN++; }
      else { if (rows.length < CAP * 2) rows.push({ text: body, tone: "ctx", n: newN }); else more++; oldN++; newN++; }
    }
  }
  const noteBits: string[] = [];
  if (tur.originalFile != null) noteBits.push(`originalFile ${String(tur.originalFile).length} chars`);
  if (tur.userModified != null) noteBits.push(`userModified ${tur.userModified}`);
  return { t: "diff", head: name, added, removed, rows, more, note: noteBits.join(" · ") || undefined };
}

function resultItem(tur: any): FireItem | null {
  if (tur && typeof tur === "object") {
    if (tur.stdout != null || tur.stderr != null) {
      const out = String(tur.stdout || "").replace(/\n+$/, "");
      const err = String(tur.stderr || "").replace(/\n+$/, "");
      const rows: Line[] = [];
      let more = 0;
      if (out) { rows.push({ text: "stdout", tone: "dim" }); const c = capBlock(out, "dim", ""); rows.push(...c.rows); more += c.more; }
      if (err) { rows.push({ text: "stderr", tone: "err" }); const c = capBlock(err, "err", ""); rows.push(...c.rows); more += c.more; }
      if (!out && !err) rows.push({ text: "(empty output)", tone: "dim" });
      return { t: "result", head: tur.interrupted ? "tool_result · interrupted" : "tool_result", rows, more };
    }
    if (tur.file && typeof tur.file === "object") {
      const f = tur.file;
      const c = capBlock(f.content || "", "dim", "");
      return { t: "result", head: `read ${f.filePath || ""} · ${f.numLines ?? "?"} lines`, rows: c.rows, more: c.more };
    }
    const c = capBlock(JSON.stringify(tur, null, 2), "dim", "");
    return { t: "result", head: "tool_result", rows: c.rows, more: c.more };
  }
  if (typeof tur === "string" && tur.trim()) {
    const c = capBlock(tur, "dim", "");
    return { t: "result", head: "tool_result", rows: c.rows, more: c.more };
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const time = (ts: unknown) =>
  ts ? new Date(ts as string).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";

export type Firehose = { id: string | null; project: string; items: FireItem[]; full: boolean };

const fireCache = new Map<string, Firehose>();

export function firehoseFor(id: string | null): Firehose {
  const sid = id && id !== "new" ? id : latestSessionId();
  if (!sid) return { id: null, project: "", items: [], full: false };

  let file = "";
  let mtime = 0;
  try {
    file = sessionFilePath(sid);
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return { id: sid, project: "", items: [], full: false };
  }
  // Append-only file → (path, mtime) identifies the content. Skip the re-read +
  // re-parse of the 2MB tail when nothing changed since the last firehose tick
  // (CODE-REVIEW PERF-7).
  const cacheKey = `${file}:${mtime}`;
  const cached = fireCache.get(cacheKey);
  if (cached) return cached;

  let text: string;
  let partial = false;
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - TAIL_BYTES);
    partial = start > 0;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch {
    return { id: sid, project: "", items: [], full: false };
  }

  const project = (() => {
    try { return sessionMeta(file, mtime).project; } catch { return ""; }
  })();

  const lines = text.split("\n");
  if (partial) lines.shift();

  const items: FireItem[] = [];
  let lastCwd: string | null = null, lastBranch: string | null = null, lastVer: string | null = null, lastUuid: string | null = null;

  const meta = (e: {
    isSidechain?: boolean;
    cwd?: string;
    gitBranch?: string;
    version?: string;
    parentUuid?: string;
    uuid?: string;
    interruptedMessageId?: string;
  }) => {
    if (e.isSidechain) items.push({ t: "meta", text: "sidechain" });
    const bits: string[] = [];
    if (e.cwd && e.cwd !== lastCwd) { bits.push(`cwd ${e.cwd}`); lastCwd = e.cwd; }
    if (e.gitBranch && e.gitBranch !== lastBranch) { bits.push(`branch ${e.gitBranch}`); lastBranch = e.gitBranch; }
    if (e.version && e.version !== lastVer) { bits.push(`cc v${e.version}`); lastVer = e.version; }
    if (bits.length) items.push({ t: "meta", text: bits.join(" · ") });
    if (e.parentUuid && lastUuid && e.uuid && e.parentUuid !== lastUuid)
      items.push({ t: "branch", text: `branch — parent ${short(e.parentUuid)} ≠ prev ${short(lastUuid)} (rewind / edited message)` });
    if (e.interruptedMessageId) items.push({ t: "branch", text: `interrupted — message ${short(e.interruptedMessageId)}` });
    if (e.uuid) lastUuid = e.uuid;
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const line of lines) {
    if (!line) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    meta(e);

    if (e.type === "assistant") {
      const m = e.message ?? {};
      const sub = [m.model, e.requestId ? `req ${short(e.requestId)}` : "", m.stop_reason ? `stop:${m.stop_reason}` : ""].filter(Boolean).join(" · ");
      items.push({ t: "assistant", at: time(e.timestamp), sub });
      const content = Array.isArray(m.content) ? m.content : typeof m.content === "string" ? [{ type: "text", text: m.content }] : [];
      for (const b of content) {
        if (b.type === "thinking") {
          const sig = b.signature || "";
          const chars = (b.thinking || "").length;
          items.push({ t: "thinking", text: `${chars ? `${chars} chars readable` : "SEALED (no plaintext stored)"} · signature ${sig.slice(0, 32)}… (${sig.length} chars)` });
        } else if (b.type === "redacted_thinking") {
          items.push({ t: "thinking", text: "REDACTED" });
        } else if (b.type === "text") {
          if ((b.text || "").trim()) items.push({ t: "text", text: b.text.trim() });
        } else if (b.type === "tool_use") {
          const { lines: tl, more } = toolLines(b.name, b.input);
          items.push({ t: "tool", name: b.name, id: short(b.id), lines: tl, more });
        }
      }
      const u = m.usage;
      if (u) {
        const cc = u.cache_creation || {};
        const eph: string[] = [];
        if (cc.ephemeral_1h_input_tokens != null) eph.push(`1h ${cc.ephemeral_1h_input_tokens}`);
        if (cc.ephemeral_5m_input_tokens != null) eph.push(`5m ${cc.ephemeral_5m_input_tokens}`);
        const main = `in ${u.input_tokens ?? 0} · out ${u.output_tokens ?? 0} · cache_read ${u.cache_read_input_tokens ?? 0} · cache_write ${u.cache_creation_input_tokens ?? 0}${eph.length ? ` · cache(${eph.join("/")})` : ""}`;
        const subBits: string[] = [];
        if (u.service_tier) subBits.push(`tier ${u.service_tier}`);
        if (u.speed) subBits.push(`speed ${u.speed}`);
        const s = u.server_tool_use;
        if (s && (s.web_search_requests || s.web_fetch_requests)) subBits.push(`server_tools ws:${s.web_search_requests} wf:${s.web_fetch_requests}`);
        items.push({ t: "usage", main, sub: subBits.join(" · ") || undefined, ms: e.durationMs ?? undefined });
      }
      continue;
    }

    if (e.type === "user") {
      const c = e.message?.content;
      const blocks = Array.isArray(c) ? c : [];
      if (e.toolUseResult != null || blocks.some((b: any) => b?.type === "tool_result")) {
        const d = diffItem(e.toolUseResult);
        if (d) { items.push(d); continue; }
        const r = resultItem(e.toolUseResult);
        if (r) { items.push(r); continue; }
        const tr = blocks.find((b: any) => b?.type === "tool_result");
        if (tr) { const cc = capBlock(typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content, null, 2), "dim", ""); items.push({ t: "result", head: "tool_result", rows: cc.rows, more: cc.more }); }
        continue;
      }
      const raw = typeof c === "string" ? c : blocks.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join("\n");
      const cmd = raw.match(/<command-name>([^<]*)<\/command-name>/);
      const reminders = (raw.match(/<system-reminder>/g) || []).length;
      const human = raw
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
        .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
        .replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, "")
        .trim();
      const tag = [e.isMeta ? "meta" : "", e.promptId ? `prompt ${short(e.promptId)}` : ""].filter(Boolean).join(" · ");
      items.push({ t: "user", at: time(e.timestamp), tag, cmd: cmd ? cmd[1].trim() : undefined, text: human, reminders, images: e.imagePasteIds?.join(", ") });
      continue;
    }

    if (e.type === "system") {
      items.push({ t: "system", head: `system · ${e.subtype || "?"} · ${e.level || ""}${e.durationMs != null ? ` · ${e.durationMs}ms` : ""}`, body: e.content ? String(e.content).slice(0, 2000) : undefined });
      continue;
    }
    if (e.type === "file-history-snapshot") {
      items.push({ t: "note", icon: "⟲", text: `file-history-snapshot${e.isSnapshotUpdate ? " (update)" : ""}${e.messageId ? ` · msg ${short(e.messageId)}` : ""}` });
      continue;
    }
    if (e.type === "permission-mode" || e.type === "mode") {
      items.push({ t: "note", icon: "🔒", text: `${e.type} → ${e.mode || e.permissionMode || "?"}` });
      continue;
    }
    if (e.type === "ai-title") { items.push({ t: "note", icon: "🏷", text: `ai-title: "${e.aiTitle || ""}"` }); continue; }
    if (e.type === "last-prompt") { items.push({ t: "note", icon: "↩", text: `last-prompt${e.lastPrompt ? `: "${String(e.lastPrompt).slice(0, 80)}"` : ""}` }); continue; }
    if (e.type === "attachment") { items.push({ t: "note", icon: "📎", text: `attachment${e.imagePasteIds?.length ? ` · ${e.imagePasteIds.join(",")}` : ""}` }); continue; }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const full = items.length > ITEM_CAP;
  const result: Firehose = {
    id: sid,
    project,
    items: full ? items.slice(-ITEM_CAP) : items,
    full: partial || full,
  };
  fireCache.set(cacheKey, result);
  if (fireCache.size > 48) fireCache.delete(fireCache.keys().next().value as string); // bound
  return result;
}

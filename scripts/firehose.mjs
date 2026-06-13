#!/usr/bin/env node
// FIREHOSE — a read-only, faithful dump of a Claude Code session transcript as
// it grows. Where follow.mjs is the clean narrative tail, Firehose shows the
// guts: every field the transcript actually stores, rendered readable but NOT
// editorialized. Nothing is computed or invented — raw token counts (no dollar
// estimate), sealed-thinking signatures, full untruncated tool I/O, diffs,
// timing, provenance, the DAG branch points, and every housekeeping entry type
// the TUI never surfaces. If it's on disk, it's here.
//
//   node scripts/firehose.mjs <session-id-or-prefix>
//   node scripts/firehose.mjs              # newest session on the machine
//   FIREHOSE_FULL=1 node scripts/firehose.mjs <id>   # remove per-block line caps
//
// Read-only: typing here does nothing; the session is driven elsewhere.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const POLL_MS = 500;
const BACKLOG_BYTES = 256 * 1024;
const FULL = !!process.env.FIREHOSE_FULL;
const CAP = FULL ? Infinity : 120; // max lines drawn per block (display only; truncation is labeled)
const MAX_DIFF_LINES = FULL ? Infinity : 120;

const BLUE = "\x1b[34m";
const ORANGE = "\x1b[38;5;208m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function allSessions() {
  const out = [];
  for (const dir of fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(PROJECTS_ROOT, dir.name);
    for (const f of fs.readdirSync(dirPath)) {
      if (!f.endsWith(".jsonl")) continue;
      const full = path.join(dirPath, f);
      try {
        out.push({ id: f.slice(0, -6), file: full, mtime: fs.statSync(full).mtimeMs });
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const want = process.argv[2];
const session = want
  ? allSessions().find((s) => s.id.startsWith(want))
  : allSessions()[0];
if (!session) {
  console.error(`no session matching "${want ?? "(newest)"}"`);
  process.exit(1);
}

const time = (ts) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
const short = (u) => (u ? String(u).replace(/^req_/, "").slice(0, 8) : "");

// Print raw multi-line text with a prefix, capped (cap is display-only and the
// drop is always labeled so you know there's more on disk).
function plainBlock(text, prefix = "", cap = CAP) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (const l of lines.slice(0, cap)) console.log(prefix + l);
  if (lines.length > cap) console.log(`${prefix}${DIM}… ${lines.length - cap} more lines — FIREHOSE_FULL=1 to expand${RESET}`);
}
function dimBlock(text, prefix = "  │ ", cap = CAP) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  for (const l of lines.slice(0, cap)) console.log(`${DIM}${prefix}${l}${RESET}`);
  if (lines.length > cap) console.log(`${DIM}${prefix}… ${lines.length - cap} more${RESET}`);
}

// --- provenance + DAG: print only what changes, flag rewinds -----------------
let lastCwd = null, lastBranch = null, lastVer = null, lastUuid = null;
function meta(e) {
  if (e.isSidechain) console.log(`${DIM}↳ sidechain${RESET}`);
  const bits = [];
  if (e.cwd && e.cwd !== lastCwd) { bits.push(`cwd ${e.cwd}`); lastCwd = e.cwd; }
  if (e.gitBranch && e.gitBranch !== lastBranch) { bits.push(`branch ${e.gitBranch}`); lastBranch = e.gitBranch; }
  if (e.version && e.version !== lastVer) { bits.push(`cc v${e.version}`); lastVer = e.version; }
  if (bits.length) console.log(`${DIM}   · ${bits.join(" · ")}${RESET}`);
  if (e.parentUuid && lastUuid && e.uuid && e.parentUuid !== lastUuid)
    console.log(`${YELLOW}⎇ branch — parent ${short(e.parentUuid)} ≠ prev ${short(lastUuid)} (rewind / edited message)${RESET}`);
  if (e.interruptedMessageId) console.log(`${YELLOW}✗ interrupted — message ${short(e.interruptedMessageId)}${RESET}`);
  if (e.uuid) lastUuid = e.uuid;
}

// --- the structuredPatch diff (same as follow.mjs) ---------------------------
function printDiff(tur) {
  const patch = tur?.structuredPatch;
  if (!Array.isArray(patch) || patch.length === 0) return false;
  const name = (tur.filePath || "").split("/").pop();
  let added = 0, removed = 0, total = 0;
  for (const h of patch) for (const ln of h.lines) { total++; if (ln[0] === "+") added++; else if (ln[0] === "-") removed++; }
  console.log(`${DIM}  └ ${name}${RESET}  ${GREEN}+${added}${RESET} ${RED}-${removed}${RESET}`);
  let shown = 0;
  outer: for (let hi = 0; hi < patch.length; hi++) {
    const h = patch[hi];
    if (hi > 0) console.log(`  ${DIM}   ⋯${RESET}`);
    let oldN = h.oldStart, newN = h.newStart;
    for (const ln of h.lines) {
      if (shown >= MAX_DIFF_LINES) { console.log(`  ${DIM}   … ${total - shown} more lines${RESET}`); break outer; }
      const sign = ln[0], body = ln.slice(1);
      if (sign === "+") { console.log(`  ${GREEN}${String(newN).padStart(4)} + ${body}${RESET}`); newN++; }
      else if (sign === "-") { console.log(`  ${RED}${String(oldN).padStart(4)} - ${body}${RESET}`); oldN++; }
      else { console.log(`  ${DIM}${String(newN).padStart(4)}   ${body}${RESET}`); oldN++; newN++; }
      shown++;
    }
  }
  return true;
}

// --- tool_use input (full, raw) ----------------------------------------------
function renderToolUse(b) {
  const i = b.input ?? {};
  console.log(`${CYAN}  › ${b.name}${RESET}${b.id ? ` ${DIM}(${short(b.id)})${RESET}` : ""}`);
  if (i.command != null) dimBlock(i.command, "      $ ");
  if (i.file_path != null) console.log(`      ${DIM}file_path: ${i.file_path}${RESET}`);
  if (i.path != null && i.file_path == null) console.log(`      ${DIM}path: ${i.path}${RESET}`);
  if (i.pattern != null) console.log(`      ${DIM}pattern: ${i.pattern}${RESET}`);
  if (i.glob != null) console.log(`      ${DIM}glob: ${i.glob}${RESET}`);
  if (i.offset != null || i.limit != null) console.log(`      ${DIM}range: offset ${i.offset ?? "-"} · limit ${i.limit ?? "-"}${RESET}`);
  if (i.old_string != null) { console.log(`      ${DIM}old_string:${RESET}`); dimBlock(i.old_string, "      - "); }
  if (i.new_string != null) { console.log(`      ${DIM}new_string:${RESET}`); dimBlock(i.new_string, "      + "); }
  if (i.content != null && i.file_path != null) { console.log(`      ${DIM}content (${i.content.length} chars):${RESET}`); dimBlock(i.content, "      | "); }
  if (i.replace_all) console.log(`      ${DIM}replace_all: true${RESET}`);
  if (i.description != null) console.log(`      ${DIM}description: ${i.description}${RESET}`);
  if (i.prompt != null) { console.log(`      ${DIM}prompt:${RESET}`); dimBlock(i.prompt, "      "); }
  if (i.todos != null) { console.log(`      ${DIM}todos:${RESET}`); dimBlock(JSON.stringify(i.todos, null, 2), "      "); }
  const handled = new Set(["command", "file_path", "path", "pattern", "glob", "offset", "limit", "old_string", "new_string", "content", "replace_all", "description", "prompt", "todos"]);
  const extra = Object.keys(i).filter((k) => !handled.has(k));
  if (extra.length) console.log(`      ${DIM}+ ${extra.map((k) => `${k}=${JSON.stringify(i[k]).slice(0, 80)}`).join(" · ")}${RESET}`);
}

// --- tool_result (full, raw) -------------------------------------------------
function renderToolResult(e) {
  const tur = e.toolUseResult;
  if (tur && typeof tur === "object") {
    if (Array.isArray(tur.structuredPatch) && tur.structuredPatch.length) {
      printDiff(tur);
      const extra = [];
      if (tur.originalFile != null) extra.push(`originalFile ${tur.originalFile.length} chars`);
      if (tur.userModified != null) extra.push(`userModified ${tur.userModified}`);
      if (tur.replaceAll != null) extra.push(`replaceAll ${tur.replaceAll}`);
      if (extra.length) console.log(`${DIM}     (${extra.join(" · ")})${RESET}`);
      console.log("");
      return true;
    }
    if (tur.stdout != null || tur.stderr != null) {
      const out = String(tur.stdout || "").replace(/\n+$/, "");
      const err = String(tur.stderr || "").replace(/\n+$/, "");
      console.log(`${CYAN}  ⎘ tool_result${RESET}${DIM}${tur.interrupted ? " · interrupted" : ""}${tur.isImage ? " · image" : ""}${RESET}`);
      if (out) { console.log(`${DIM}  ┌ stdout${RESET}`); dimBlock(out); }
      if (err) { console.log(`${RED}  ┌ stderr${RESET}`); dimBlock(err); }
      if (!out && !err) console.log(`${DIM}  (empty output)${RESET}`);
      console.log("");
      return true;
    }
    if (tur.file && typeof tur.file === "object") {
      const f = tur.file;
      console.log(`${CYAN}  ⎘ read${RESET} ${DIM}${f.filePath || ""} · ${f.numLines ?? "?"} lines${f.totalLines != null ? ` of ${f.totalLines}` : ""}${RESET}`);
      dimBlock(f.content || "");
      console.log("");
      return true;
    }
    console.log(`${CYAN}  ⎘ tool_result (raw object)${RESET}`);
    dimBlock(JSON.stringify(tur, null, 2));
    console.log("");
    return true;
  }
  if (typeof tur === "string" && tur.trim()) {
    console.log(`${CYAN}  ⎘ tool_result${RESET}`);
    dimBlock(tur);
    console.log("");
    return true;
  }
  return false;
}

// --- assistant turn ----------------------------------------------------------
function renderAssistant(e) {
  const m = e.message ?? {};
  const head = [`${ORANGE}${BOLD}● claude${RESET}`, `${DIM}${time(e.timestamp)}${RESET}`];
  if (m.model) head.push(`${DIM}${m.model}${RESET}`);
  if (e.requestId) head.push(`${DIM}req ${short(e.requestId)}${RESET}`);
  if (m.stop_reason) head.push(`${DIM}stop:${m.stop_reason}${RESET}`);
  console.log(head.join("  "));

  const content = Array.isArray(m.content)
    ? m.content
    : typeof m.content === "string" ? [{ type: "text", text: m.content }] : [];
  for (const b of content) {
    if (b.type === "thinking") {
      const sig = b.signature || "";
      const tlen = (b.thinking || "").length;
      console.log(`${MAGENTA}  🧠 thinking${RESET} ${DIM}— ${tlen ? `${tlen} chars readable` : "SEALED (no plaintext stored)"} · signature ${sig.slice(0, 32)}…${RESET} ${DIM}(${sig.length} chars)${RESET}`);
      if (tlen) plainBlock(b.thinking, "     ");
    } else if (b.type === "redacted_thinking") {
      console.log(`${MAGENTA}  🧠 thinking — REDACTED${RESET}`);
    } else if (b.type === "text") {
      if ((b.text || "").trim()) plainBlock(b.text.trim(), "");
    } else if (b.type === "tool_use") {
      renderToolUse(b);
    } else {
      console.log(`${DIM}  [block ${b.type}] ${JSON.stringify(b).slice(0, 160)}${RESET}`);
    }
  }

  const u = m.usage;
  if (u) {
    const cc = u.cache_creation || {};
    const eph = [];
    if (cc.ephemeral_1h_input_tokens != null) eph.push(`1h ${cc.ephemeral_1h_input_tokens}`);
    if (cc.ephemeral_5m_input_tokens != null) eph.push(`5m ${cc.ephemeral_5m_input_tokens}`);
    const parts = [
      `in ${u.input_tokens ?? 0}`,
      `out ${u.output_tokens ?? 0}`,
      `cache_read ${u.cache_read_input_tokens ?? 0}`,
      `cache_write ${u.cache_creation_input_tokens ?? 0}`,
    ];
    console.log(`${GREEN}  ∑ usage${RESET} ${DIM}${parts.join(" · ")}${eph.length ? ` · cache(${eph.join("/")})` : ""}${RESET}`);
    const sv = [];
    if (u.service_tier) sv.push(`tier ${u.service_tier}`);
    if (u.speed) sv.push(`speed ${u.speed}`);
    const s = u.server_tool_use;
    if (s && (s.web_search_requests || s.web_fetch_requests)) sv.push(`server_tools ws:${s.web_search_requests} wf:${s.web_fetch_requests}`);
    if (u.inference_geo && u.inference_geo !== "not_available") sv.push(`geo ${u.inference_geo}`);
    if (sv.length) console.log(`${DIM}     ${sv.join(" · ")}${RESET}`);
  }
  if (e.durationMs != null) console.log(`${DIM}  ⏱ ${e.durationMs}ms${RESET}`);
  console.log("");
}

// --- a human turn (system-reminders shown, dimmed — they're on disk too) -----
function renderUserText(e, raw) {
  const cmd = raw.match(/<command-name>([^<]*)<\/command-name>/);
  const reminders = [...raw.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)].map((m) => m[1].trim());
  const human = raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, "")
    .replace(/<local-command-[a-z-]+>[\s\S]*?<\/local-command-[a-z-]+>/g, "")
    .trim();
  const tags = [];
  if (e.isMeta) tags.push("meta");
  if (e.promptId) tags.push(`prompt ${short(e.promptId)}`);
  console.log(`${BLUE}${BOLD}● brendan${RESET} ${DIM}${time(e.timestamp)}${tags.length ? ` · ${tags.join(" · ")}` : ""}${RESET}`);
  if (cmd) console.log(`${DIM}  /${cmd[1].trim()}${RESET}`);
  if (human) plainBlock(human, "");
  if (e.imagePasteIds?.length) console.log(`${DIM}  📎 imagePasteIds: ${e.imagePasteIds.join(", ")}${RESET}`);
  for (const r of reminders) { console.log(`${DIM}  ┌ system-reminder${RESET}`); dimBlock(r, "  │ ", FULL ? Infinity : 12); }
  console.log("");
}

function printEntry(e) {
  meta(e);
  switch (e.type) {
    case "assistant":
      return renderAssistant(e);
    case "user": {
      const c = e.message?.content;
      const blocks = Array.isArray(c) ? c : [];
      if (e.toolUseResult != null || blocks.some((b) => b?.type === "tool_result")) {
        if (!renderToolResult(e)) {
          const tr = blocks.find((b) => b?.type === "tool_result");
          if (tr) { console.log(`${CYAN}  ⎘ tool_result${RESET}`); dimBlock(typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content, null, 2)); console.log(""); }
        }
        return;
      }
      const raw = typeof c === "string" ? c : blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
      return renderUserText(e, raw);
    }
    case "system":
      console.log(`${DIM}── system · ${e.subtype || "?"} · ${e.level || ""}${e.durationMs != null ? ` · ${e.durationMs}ms` : ""} ──${RESET}`);
      if (e.content) dimBlock(e.content);
      return console.log("");
    case "file-history-snapshot": {
      let n = "";
      if (e.snapshot && typeof e.snapshot === "object")
        n = Array.isArray(e.snapshot) ? `${e.snapshot.length} entries` : `${Object.keys(e.snapshot).length} keys`;
      return console.log(`${DIM}⟲ file-history-snapshot${e.isSnapshotUpdate ? " (update)" : ""}${e.messageId ? ` · msg ${short(e.messageId)}` : ""}${n ? ` · ${n}` : ""}${RESET}\n`);
    }
    case "permission-mode":
    case "mode":
      return console.log(`${YELLOW}🔒 ${e.type} → ${e.mode || e.permissionMode || "?"}${RESET}\n`);
    case "ai-title":
      return console.log(`${DIM}🏷  ai-title: "${e.aiTitle || ""}"${RESET}\n`);
    case "last-prompt":
      return console.log(`${DIM}↩  last-prompt marker${e.lastPrompt ? `: "${String(e.lastPrompt).slice(0, 80)}"` : ""}${RESET}\n`);
    case "attachment":
      console.log(`${DIM}📎 attachment${e.imagePasteIds?.length ? ` · imagePasteIds ${e.imagePasteIds.join(",")}` : ""}${RESET}`);
      if (e.attachment) dimBlock(typeof e.attachment === "string" ? e.attachment : JSON.stringify(e.attachment, null, 2), "  │ ", 12);
      return console.log("");
    default:
      return console.log(`${DIM}[${e.type}] keys: ${JSON.stringify(Object.keys(e))}${RESET}\n`);
  }
}

let buffer = "";
function consume(text) {
  buffer += text;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    try { printEntry(JSON.parse(line)); } catch {}
  }
}

console.log(`${DIM}FIREHOSE — ${session.id}${RESET}`);
console.log(`${DIM}read-only · every field on disk, nothing computed · ${FULL ? "FULL (uncapped)" : `capped ${CAP} lines/block — FIREHOSE_FULL=1 to uncap`} · ^C to quit${RESET}\n`);

let offset = Math.max(0, fs.statSync(session.file).size - BACKLOG_BYTES);
const readNew = () => {
  let size;
  try { size = fs.statSync(session.file).size; } catch { return; }
  if (size <= offset) return;
  const fd = fs.openSync(session.file, "r");
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = size;
  consume(buf.toString("utf8"));
};

if (offset > 0) {
  const fd = fs.openSync(session.file, "r");
  const buf = Buffer.alloc(fs.statSync(session.file).size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset += buf.length;
  consume(buf.toString("utf8").split("\n").slice(1).join("\n"));
} else {
  readNew();
}

setInterval(readNew, POLL_MS);

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

// The Docs corpus: a local, cleaned mirror of Claude Code's documentation
// (~/.claude/hq/docs), fetched by scripts/fetch-docs.mjs. HQ's offline
// best-practice oracle — a 4th Search corpus alongside transcripts, memory, and
// notes, and a reference HQ can surface contextually. All node:fs, zero network
// (the fetcher handles refresh out of process).

export const DOCS_DIR = path.join(os.homedir(), ".claude", "hq", "docs");

export type DocPage = {
  id: string; // relative path, e.g. "agent-sdk/overview.md" (stable id)
  title: string; // first markdown heading, else the id
  group: string; // top dir, e.g. "agent-sdk" / "whats-new" / "" (root)
  bytes: number;
  mtime: number;
};

// First real "# / ## heading" → title; skip the leading blockquote index banner.
function docTitle(content: string, fallback: string): string {
  for (const line of content.split("\n")) {
    const m = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (m && !/documentation index/i.test(m[1])) return m[1].slice(0, 80);
  }
  return fallback;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".md")) out.push(full);
  }
}

export function listDocs(): DocPage[] {
  const files: string[] = [];
  walk(DOCS_DIR, files);
  const out: DocPage[] = [];
  for (const full of files) {
    const id = path.relative(DOCS_DIR, full);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    let content = "";
    try {
      content = fs.readFileSync(full, "utf8");
    } catch {
      // vanished mid-scan
    }
    out.push({
      id,
      title: docTitle(content, id.replace(/\.md$/, "")),
      group: id.includes("/") ? id.split("/")[0] : "",
      bytes: st.size,
      mtime: st.mtimeMs,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Read one page for the in-panel reader. Guarded so a crafted id can't walk out
// of the docs dir.
export function readDoc(id: string): string | null {
  const full = path.resolve(DOCS_DIR, id);
  if (!full.startsWith(DOCS_DIR + path.sep) || !full.endsWith(".md")) return null;
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

// Freshness for display + the startup/poll refresh decision.
export function docsManifest(): { fetchedAt: number; pageCount: number } {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, "_manifest.json"), "utf8"));
    return { fetchedAt: m.fetchedAt ?? 0, pageCount: m.pageCount ?? 0 };
  } catch {
    return { fetchedAt: 0, pageCount: 0 };
  }
}

// Refresh the mirror in the background if it's missing or stale (>1 day), the
// same out-of-process / deduped pattern lib/archive.ts uses for the search
// index. Cheap to call on every /search load — it no-ops while fresh. The
// fetcher sends conditional GETs, so a refresh re-pulls only changed pages.
const FETCH_SCRIPT = path.join(process.cwd(), "scripts", "fetch-docs.mjs");
const REFRESH_MS = 24 * 60 * 60 * 1000;
let refreshing = false;
export function warmDocs(): void {
  if (refreshing) return;
  const { fetchedAt, pageCount } = docsManifest();
  if (pageCount > 0 && Date.now() - fetchedAt < REFRESH_MS) return; // fresh
  refreshing = true;
  try {
    const child = spawn(process.execPath, [FETCH_SCRIPT], { detached: true, stdio: "ignore" });
    child.on("exit", () => (refreshing = false));
    child.on("error", () => (refreshing = false));
    child.unref();
  } catch {
    refreshing = false;
  }
}

// Per-page cleaned text for the Search corpus (content is already MDX-stripped
// by the fetcher, so this is a straight read).
export function docsText(): { id: string; title: string; text: string }[] {
  const files: string[] = [];
  walk(DOCS_DIR, files);
  const out: { id: string; title: string; text: string }[] = [];
  for (const full of files) {
    try {
      const content = fs.readFileSync(full, "utf8");
      const id = path.relative(DOCS_DIR, full);
      out.push({ id, title: docTitle(content, id.replace(/\.md$/, "")), text: content });
    } catch {
      // skip
    }
  }
  return out;
}

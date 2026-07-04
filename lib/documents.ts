import fs from "node:fs";
import path from "node:path";
import { claudeHome } from "./config";
import { randomBytes } from "node:crypto";
import { writeFileAtomicSync } from "./atomic";

// HQ Documents — the Docs surface's own store: living .md documents under
// ~/.claude/hq/documents (HQ-native, beside todo.json / notes). Distinct from
// BOTH the notes store (one-shot saved blocks) and ~/.claude/hq/docs (the
// fetched Claude Code documentation mirror, lib/docs.ts). A document is a
// long-lived, editable page: frontmatter carries title + provenance, the body
// is markdown the Docs editor round-trips.
export const DOCUMENTS_DIR = path.join(claudeHome(), "hq", "documents");

export type DocumentMeta = {
  name: string; // file name (the ref)
  title: string;
  createdAt: number;
  updatedAt: number;
  session?: string;
};

// Frontmatter `title:` wins; else the first non-empty body line; else "untitled".
export function documentTitle(content: string): string {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  const t = fm?.[1].match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (t) return t.slice(0, 120);
  const body = content.replace(/^---[\s\S]*?\n---\s*/, "").trim();
  return (body.split("\n").find((l) => l.trim()) || "untitled")
    .replace(/^#+\s*/, "")
    .slice(0, 120);
}

export function listDocuments(): DocumentMeta[] {
  let names: string[];
  try {
    names = fs.readdirSync(DOCUMENTS_DIR);
  } catch {
    return [];
  }
  const out: DocumentMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const full = path.join(DOCUMENTS_DIR, name);
    try {
      const content = fs.readFileSync(full, "utf8");
      const st = fs.statSync(full);
      const created = content.match(/^createdAt:\s*(.+)$/m)?.[1]?.trim();
      const session = content.match(/^session:\s*(.+)$/m)?.[1]?.trim();
      out.push({
        name,
        title: documentTitle(content),
        createdAt: created ? Date.parse(created) || st.birthtimeMs : st.birthtimeMs,
        updatedAt: st.mtimeMs,
        session,
      });
    } catch {
      // vanished mid-scan
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Read one document, raw (frontmatter and all). Basename-guarded like notes.
export function getDocumentFile(name: string): string | null {
  const base = path.basename(name);
  if (!base.endsWith(".md")) return null;
  try {
    return fs.readFileSync(path.join(DOCUMENTS_DIR, base), "utf8");
  } catch {
    return null;
  }
}

// Overwrite an EXISTING document's full content — the /api/file-edit writer.
export function writeDocumentFile(name: string, content: string): boolean {
  const base = path.basename(name);
  if (!base.endsWith(".md")) return false;
  const full = path.join(DOCUMENTS_DIR, base);
  if (!fs.existsSync(full)) return false;
  try {
    writeFileAtomicSync(full, content);
    return true;
  } catch {
    return false;
  }
}

export type DocumentInput = {
  title?: string;
  text?: string; // initial body markdown
  sessionId?: string;
  source?: string; // e.g. "block" | "tool-step" — where it was born
};

// Create a new document and return its file name. Length-capped like notes so a
// hostile POST can't disk-fill; frontmatter values are newline-stripped so a
// value can't inject extra keys.
export function createDocument(input: DocumentInput = {}): string {
  const text = (input.text || "").slice(0, 500_000);
  const createdAt = Date.now();
  const name = `doc-${createdAt}-${randomBytes(3).toString("hex")}.md`;
  const fm1 = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const title = fm1(input.title || "").slice(0, 120) || "Untitled";
  const fm = [
    "---",
    "doc: true",
    `title: ${title}`,
    `createdAt: ${new Date(createdAt).toISOString()}`,
    input.sessionId ? `session: ${fm1(input.sessionId)}` : "",
    input.source ? `source: ${fm1(input.source)}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n");
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  writeFileAtomicSync(
    path.join(DOCUMENTS_DIR, name),
    `${fm}\n\n${text ? `${text.trim()}\n` : ""}`
  );
  return name;
}

export function deleteDocument(name: string): boolean {
  const base = path.basename(name);
  if (!base.endsWith(".md")) return false;
  try {
    fs.unlinkSync(path.join(DOCUMENTS_DIR, base));
    return true;
  } catch {
    return false;
  }
}

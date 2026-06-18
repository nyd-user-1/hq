import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";

// Saved "note blocks" — a message block the user starred from a terminal, kept
// as a specially-labeled .md under ~/.claude/hq/notes (HQ-native, same home as
// todo.json) so HQ Search can surface it later. Frontmatter carries provenance;
// the body is the block text verbatim. Distinct from the agent's memory dir.
export const NOTES_DIR = path.join(os.homedir(), ".claude", "hq", "notes");

export type NoteInput = {
  text: string;
  role?: string; // "user" | "assistant"
  project?: string;
  sessionId?: string;
  at?: string; // source block timestamp (for dedupe / provenance)
};

export type NoteMeta = { name: string; title: string; savedAt: number };

// Strip the --- frontmatter --- block, return the first non-empty body line.
// Tolerates a closing --- with no trailing newline (older saves glued the body
// to the delimiter), so the title is the first BODY line, not the "---" fence.
export function noteTitle(content: string): string {
  const body = content.replace(/^---[\s\S]*?\n---\s*/, "").trim();
  return (body.split("\n").find((l) => l.trim()) || "note").slice(0, 60);
}

export function saveNote(input: NoteInput): string {
  const text = (input.text || "").trim();
  if (!text) throw new Error("empty note");
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const savedAt = Date.now();
  const name = `note-${savedAt}-${randomBytes(3).toString("hex")}.md`;
  const fm = [
    "---",
    "note: true",
    `savedAt: ${new Date(savedAt).toISOString()}`,
    input.sessionId ? `session: ${input.sessionId}` : "",
    input.role ? `role: ${input.role}` : "",
    input.project ? `project: ${input.project}` : "",
    input.at ? `sourceAt: ${input.at}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n");
  // Blank line AFTER the closing --- so the body never glues to the delimiter.
  // (A trailing "" in the array used to do this, but .filter(Boolean) — needed
  // to drop the optional fields — ate it too, which broke noteTitle's strip.)
  fs.writeFileSync(path.join(NOTES_DIR, name), `${fm}\n\n${text}\n`);
  return name;
}

export function getNotes(): NoteMeta[] {
  let names: string[];
  try {
    names = fs.readdirSync(NOTES_DIR);
  } catch {
    return [];
  }
  const out: NoteMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const full = path.join(NOTES_DIR, name);
    try {
      out.push({
        name,
        title: noteTitle(fs.readFileSync(full, "utf8")),
        savedAt: fs.statSync(full).mtimeMs,
      });
    } catch {
      // vanished mid-scan
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

// Read one note for the in-panel reader. Basename-guarded so a crafted ?openNote
// can't walk out of the notes dir.
export function getNoteFile(name: string): string | null {
  const base = path.basename(name);
  if (!base.endsWith(".md")) return null;
  try {
    return fs.readFileSync(path.join(NOTES_DIR, base), "utf8");
  } catch {
    return null;
  }
}

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseFrontmatter } from "@/lib/frontmatter";

// Discover the user's installed skills from disk — same "disk is the database"
// read as the rest of HQ. Each skill is a folder under ~/.claude/skills/<name>/
// with a SKILL.md whose YAML frontmatter carries name + description (+ optional
// argument-hint / allowed-tools / disable-model-invocation). We parse that so the
// Skills panel reflects REAL skills with their real trigger descriptions, not a
// hardcoded list. Token count is the ~4 chars/token estimate (matches the audit).
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

export type Skill = {
  name: string; // folder slug = the slash command (/<name>)
  title: string; // frontmatter `name` (falls back to the slug)
  description: string;
  argHint: string; // `argument-hint`, when present
  autoInvoke: boolean; // false when `disable-model-invocation: true`
  tokens: number;
  mtime: number;
  path: string; // absolute SKILL.md path — the row opens this in-panel
};

const est = (s: string) => Math.round(s.length / 4);

export function getSkills(): Skill[] {
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return []; // no skills dir on this machine
  }
  const skills: Skill[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(SKILLS_DIR, dir.name, "SKILL.md");
    try {
      const text = fs.readFileSync(file, "utf8");
      const fm = parseFrontmatter(text);
      skills.push({
        name: dir.name,
        title: fm.name || dir.name,
        description: fm.description || "",
        argHint: fm["argument-hint"] || "",
        autoInvoke: fm["disable-model-invocation"] !== "true",
        tokens: est(text),
        mtime: fs.statSync(file).mtimeMs,
        path: file,
      });
    } catch {
      // no SKILL.md / vanished mid-scan — skip
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// Read a skill's SKILL.md for the in-panel reader. Guarded: only files under
// ~/.claude/skills ending in .md, so an ?open=<path> param can't read elsewhere.
export function readSkillDoc(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(SKILLS_DIR + path.sep)) return null;
    if (!resolved.endsWith(".md")) return null;
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return null;
  }
}

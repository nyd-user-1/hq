import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Trusted Folders: the project directories Claude Code already knows about, read
// straight off ~/.claude.json. The CLI keys its top-level `projects` object by
// the project's ABSOLUTE PATH; each entry carries `hasTrustDialogAccepted` — the
// flag set once you've answered "Do you trust the files in this folder?" for that
// directory. So the on-disk file IS the registry: HQ reads it, lists every known
// folder, and marks which ones you've trusted. Pure node:fs, defensive, [] if the
// file or its `projects` map is absent or malformed.

export type TrustedFolder = {
  path: string; // absolute project directory (the projects-map key)
  trusted?: boolean; // hasTrustDialogAccepted — undefined when the flag is absent
};

const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");

export function getTrustedFolders(): TrustedFolder[] {
  let raw: string;
  try {
    raw = fs.readFileSync(CLAUDE_JSON, "utf8");
  } catch {
    return []; // no ~/.claude.json on this machine
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // malformed JSON
  }

  const projects =
    parsed && typeof parsed === "object"
      ? (parsed as { projects?: unknown }).projects
      : undefined;
  if (!projects || typeof projects !== "object") return [];

  const out: TrustedFolder[] = [];
  for (const [dir, entry] of Object.entries(projects as Record<string, unknown>)) {
    if (!dir) continue;
    const accepted =
      entry && typeof entry === "object"
        ? (entry as { hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted
        : undefined;
    out.push({
      path: dir,
      trusted: typeof accepted === "boolean" ? accepted : undefined,
    });
  }

  // Stable, readable order: by path.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

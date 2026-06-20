import { NextResponse } from "next/server";
import { turnsFor } from "@/lib/transcript";
import { retainedTranscriptText } from "@/lib/archive";
import { getMemoryFile, getScriptFile } from "@/lib/search";
import { getNoteFile } from "@/lib/notes";
import { readDoc } from "@/lib/docs";
import { getRepoFile } from "@/lib/files";
import { getCommit } from "@/lib/shipped";
import { readSkillDoc } from "@/lib/skills";
import { getTodos } from "@/lib/todo";
import { getProjectSessions } from "@/lib/projects";
import { COMPONENTS, readComponentSource } from "@/lib/components";

export const dynamic = "force-dynamic";

// Content for the ⌘K inline viewer: given a hit's kind + ref, return its readable
// body so the palette can drop it in beneath the result (read it without leaving
// ⌘K). One source of truth with the /search panel's in-panel readers. `format`
// tells the client how to render: "turns" (a chat transcript), "markdown", or
// "code". Same kind→ref contract as command-palette's openHref.

type Turn = { role: string; text: string };
type Body =
  | { format: "turns"; turns: Turn[]; note?: string }
  | { format: "markdown"; content: string }
  | { format: "code"; content: string };

function build(kind: string, ref: string): Body {
  switch (kind) {
    case "transcript":
    case "session":
    case "sdk": {
      const { turns } = turnsFor(ref, 250);
      if (turns.length) return { format: "turns", turns };
      // .jsonl swept by Claude Code's 30-day sweep → fall back to retained text.
      const archived = retainedTranscriptText(ref);
      return archived
        ? {
            format: "turns",
            turns: [{ role: "archived", text: archived }],
            note: "archived · source transcript swept from disk",
          }
        : { format: "markdown", content: "_transcript not found_" };
    }
    case "doc":
      return { format: "markdown", content: readDoc(ref) ?? "_doc not found_" };
    case "memory":
      return { format: "markdown", content: getMemoryFile(ref) ?? "_memory not found_" };
    case "note": {
      const c = getNoteFile(ref);
      return {
        format: "markdown",
        content: c ? c.replace(/^---[\s\S]*?---\n/, "") : "_note not found_",
      };
    }
    case "script":
      return { format: "code", content: getScriptFile(ref) ?? "// script not found" };
    case "file":
      return { format: "code", content: getRepoFile(ref) ?? "// file not found" };
    case "component": {
      const c = COMPONENTS.find((x) => x.name === ref);
      return {
        format: "code",
        content: (c && readComponentSource(c.file)) || "// component source not found",
      };
    }
    case "commit": {
      const slash = ref.indexOf("/");
      const repo = slash > 0 ? ref.slice(0, slash) : "";
      const sha = slash > 0 ? ref.slice(slash + 1) : "";
      const commit = repo && sha ? getCommit(repo, sha) : null;
      return { format: "code", content: commit?.text ?? "commit not found" };
    }
    case "todo": {
      const t = getTodos().find((x) => x.id === ref);
      return {
        format: "markdown",
        content: t ? `**${t.text}**\n\n${t.body ?? "_no description_"}` : "_todo not found_",
      };
    }
    case "skill":
      return { format: "markdown", content: readSkillDoc(ref) ?? "_skill not found_" };
    case "project": {
      const rows = getProjectSessions(ref);
      const lines = rows
        .map((s) => `- ${s.customTitle || s.title} · \`${s.id.slice(0, 8)}\``)
        .join("\n");
      return {
        format: "markdown",
        content: rows.length ? `Sessions in **${ref}**:\n\n${lines}` : "_no sessions_",
      };
    }
    default:
      return { format: "markdown", content: "" };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") ?? "";
  const ref = searchParams.get("ref") ?? "";
  if (!ref) return NextResponse.json({ format: "markdown", content: "" } as Body);
  return NextResponse.json(build(kind, ref));
}

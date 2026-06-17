import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { NextResponse } from "next/server";
import { getTodos, enrichTodos, type TodoGraph } from "@/lib/todo";

export const maxDuration = 300;

// Stage-1 Evaluator. Infers the execution graph (writes/reads/dependsOn/effort/
// category) for un-evaluated todos in ONE batched, tool-free `claude -p` call —
// the whole backlog enriched in a single trip, not N. The stable instruction
// prefix is cacheable, so re-running over a growing list stays cheap. Output is
// validated/clamped before it touches the store.

const ROOT = process.cwd();
const CATEGORIES = ["efficiency", "ui", "functionality", "data", "docs"];

function listFiles(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let ents: import("node:fs").Dirent[];
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(tsx?|mjs|md|css)$/.test(e.name)) out.push(relative(ROOT, full));
    }
  };
  for (const d of dirs) walk(join(ROOT, d));
  return out;
}

function extractJsonArray(text: string): unknown[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function asGraph(g: unknown, validIds: Set<string>): TodoGraph | null {
  if (!g || typeof g !== "object") return null;
  const o = g as Record<string, unknown>;
  if (typeof o.id !== "string" || !validIds.has(o.id)) return null;
  return {
    id: o.id,
    writes: strArr(o.writes).slice(0, 20),
    reads: strArr(o.reads).slice(0, 20),
    dependsOn: strArr(o.dependsOn).filter((x) => validIds.has(x) && x !== o.id),
    effort:
      typeof o.effort === "number" && Number.isFinite(o.effort)
        ? Math.max(50, Math.min(8000, Math.round(o.effort)))
        : 500,
    category:
      typeof o.category === "string" && CATEGORIES.includes(o.category)
        ? o.category
        : undefined,
  };
}

export async function POST(req: Request) {
  const { all } = await req.json().catch(() => ({}));
  const active = getTodos().filter((t) => !t.done && !t.parentId);
  const targets = all ? active : active.filter((t) => typeof t.effort !== "number");
  if (!targets.length) {
    return NextResponse.json({ evaluated: 0, items: getTodos(), note: "nothing to evaluate" });
  }

  const files = listFiles(["app", "lib", "scripts"]);
  const tasks = targets.map((t) => ({ id: t.id, title: t.text, body: t.body ?? "" }));
  const prompt = [
    "You are a senior engineer planning a coding backlog for the HQ codebase.",
    "For EACH task, infer its execution graph. Reply with ONLY a JSON array — no",
    "prose, no markdown fences. Each element exactly:",
    '{ "id": <task id>, "writes": [repo-relative paths it will MODIFY],',
    '  "reads": [files it must READ for context], "dependsOn": [task ids that must',
    '  finish first], "effort": <estimated OUTPUT tokens, integer>,',
    `  "category": one of ${JSON.stringify(CATEGORIES)} }`,
    "Use ONLY paths from the FILE LIST, or a plausible new path under app/ or lib/.",
    "dependsOn ids MUST come from the task list. Do NOT use any tools — infer from",
    "the titles/bodies and the file list alone.",
    "",
    "FILE LIST:",
    files.join("\n"),
    "",
    "TASKS:",
    JSON.stringify(tasks, null, 2),
  ].join("\n");

  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        "claude",
        ["-p", prompt, "--output-format", "json"],
        { cwd: ROOT, timeout: 290_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env } },
        (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))
      );
    });

    // `--output-format json` wraps the model text in an envelope; unwrap to .result.
    let text = out;
    try {
      const env = JSON.parse(out);
      if (env && typeof env.result === "string") text = env.result;
    } catch {
      /* not the envelope — treat stdout as the text */
    }

    const arr = extractJsonArray(text);
    if (!arr) {
      return new NextResponse("evaluator returned unparseable output", { status: 502 });
    }
    const validIds = new Set(targets.map((t) => t.id));
    const graphs = arr
      .map((g) => asGraph(g, validIds))
      .filter((g): g is TodoGraph => g !== null);
    const items = enrichTodos(graphs);
    return NextResponse.json({ evaluated: graphs.length, items });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : String(e), { status: 500 });
  }
}

import { execFile, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const maxDuration = 300; // Vercel hobby cap; locally the dev server has no limit

// HQ-spawned headless runs, keyed by the session id they were asked to resume.
// Lets DELETE kill a runaway — HQ can only stop runs IT spawned, not sessions
// it merely observes.
const running = new Map<string, ChildProcess>();

// Where pasted/dropped screenshots land before the headless run reads them via
// an `@<path>` mention. Under ~/.claude so it's co-located with Claude's own
// data and exists for any Claude Code user (universal, no config). Claude Code
// embeds the image into the turn at ingest, so the file is only needed at send
// time — we keep it briefly and GC on a TTL rather than racing a delete.
const PASTE_DIR = join(homedir(), ".claude", "hq-pastes");
const PASTE_TTL = 24 * 60 * 60 * 1000; // 24h
const MAX_IMAGES = 8;
const MAX_BYTES = 12 * 1024 * 1024; // per image, decoded — defensive

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

type InboundImage = { data: string; mime: string };

// Drop paste files older than the TTL. Cheap, bounded, runs per send — keeps
// the dir from growing without a daemon.
async function gcPastes() {
  try {
    const cutoff = Date.now() - PASTE_TTL;
    for (const name of await readdir(PASTE_DIR)) {
      const p = join(PASTE_DIR, name);
      try {
        if ((await stat(p)).mtimeMs < cutoff) await unlink(p);
      } catch {
        /* file vanished mid-loop — fine */
      }
    }
  } catch {
    /* dir doesn't exist yet — nothing to GC */
  }
}

// Decode each base64 image to a file under PASTE_DIR and return absolute paths.
// Filenames are [a-z0-9] only so the `@<path>` mention never breaks on a space.
async function writeImages(images: InboundImage[]): Promise<string[]> {
  await mkdir(PASTE_DIR, { recursive: true });
  const paths: string[] = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    const ext = EXT[img.mime];
    if (!ext) continue; // unknown type — skip rather than write garbage
    const buf = Buffer.from(img.data, "base64");
    if (!buf.length || buf.length > MAX_BYTES) continue;
    const file = join(PASTE_DIR, `${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`);
    await writeFile(file, buf);
    paths.push(file);
  }
  return paths;
}

// Spawns a headless `claude --resume` — a separate process that can edit the
// resumed project's repo in parallel with any live terminal (the 001.8
// incident). GUARDED: the caller must name its target session explicitly; the
// implicit "newest" fallback is gone, and the UI confirms before posting here.
// Screenshots ride along as `images` (base64) → written to disk → referenced as
// `@<path>` mentions so Claude reads them as vision, all on the same one-shot
// `-p` path (no stream-json, no extra deps).
export async function POST(req: Request) {
  const { prompt, sessionId, images, model } = await req.json();
  // Optional model override for this send → `claude --model <m>`. The CLI docs
  // it as "model for the current session", so it sets the resumed session's
  // model. Validated to a safe token (execFile is shell-free, but reject junk).
  const useModel =
    typeof model === "string" && /^[a-z0-9.\-]{1,64}$/i.test(model) ? model : "";
  const imgs: InboundImage[] = Array.isArray(images)
    ? images.filter(
        (i) => i && typeof i.data === "string" && typeof i.mime === "string"
      )
    : [];
  const text = typeof prompt === "string" ? prompt : "";
  if (!text.trim() && imgs.length === 0) {
    return new NextResponse("empty prompt", { status: 400 });
  }
  if (typeof sessionId !== "string" || !sessionId) {
    return new NextResponse(
      "send requires an explicit session id — pin a session first",
      { status: 400 }
    );
  }
  if (running.has(sessionId)) {
    return new NextResponse("a send to this session is already running", {
      status: 409,
    });
  }

  let finalPrompt = text;
  if (imgs.length) {
    await gcPastes();
    const paths = await writeImages(imgs);
    if (paths.length) {
      const mentions = paths.map((p) => `@${p}`).join(" ");
      finalPrompt = text.trim() ? `${text}\n\n${mentions}` : mentions;
    }
  }
  if (!finalPrompt.trim()) {
    return new NextResponse("no usable prompt or image", { status: 400 });
  }

  try {
    const out = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "claude",
        [
          "--resume",
          sessionId,
          ...(useModel ? ["--model", useModel] : []),
          "-p",
          finalPrompt,
        ],
        {
          cwd: process.env.HOME,
          timeout: 590_000,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env },
        },
        (err, stdout, stderr) => {
          running.delete(sessionId);
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        }
      );
      running.set(sessionId, child);
    });
    return NextResponse.json({ ok: true, output: out });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : String(e), {
      status: 500,
    });
  }
}

// Stop an HQ-spawned run: kill the child for ?session=<id>.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  if (!id) return new NextResponse("session id required", { status: 400 });
  const child = running.get(id);
  if (!child) {
    return new NextResponse("no HQ-spawned run for that session", {
      status: 404,
    });
  }
  child.kill("SIGTERM");
  running.delete(id);
  return NextResponse.json({ ok: true, stopped: true });
}

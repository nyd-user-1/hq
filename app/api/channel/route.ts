import { NextResponse, type NextRequest } from "next/server";
import { pushToSession, sendVerdict, channelEvents, listChannels } from "@/lib/channel";
import { isChannelEnabled } from "@/lib/channel-mode"; // experimental-path gate (default OFF)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

// Images ride the channel EXACTLY like the driven path: decode base64 → write to
// ~/.claude/hq-pastes → reference as `@<path>` mentions in the pushed text so Claude
// reads them as vision in the SAME live session (no fork). Mirrors writeImages() in
// app/api/terminal/route.ts (kept local so we don't touch that route's drive path).
const PASTE_DIR = join(homedir(), ".claude", "hq-pastes");
const IMG_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
};
async function writeChannelImages(images: unknown): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0) return [];
  await mkdir(PASTE_DIR, { recursive: true });
  const paths: string[] = [];
  for (const img of images.slice(0, 8) as Array<{ data?: unknown; mime?: unknown }>) {
    if (!img || typeof img.data !== "string" || typeof img.mime !== "string") continue;
    const ext = IMG_EXT[img.mime];
    if (!ext) continue; // unknown type — skip rather than write garbage
    const buf = Buffer.from(img.data, "base64");
    if (buf.length > 12 * 1024 * 1024) continue; // 12MB/image guard
    const file = join(PASTE_DIR, `${randomBytes(8).toString("hex")}.${ext}`); // [a-f0-9] only → no space in the @mention
    await writeFile(file, buf);
    paths.push(file);
  }
  return paths;
}

// The HQ-side door to a session's live channel. Same-origin only (proxy.ts
// already guards it — no second auth scheme here). The per-session loopback
// token between HQ and the channel subprocess is handled inside lib/channel.ts.
//
// POST { session, content, source? }            → push a <channel> event into the live session
// POST { session, requestId, behavior }          → relay a permission verdict ("allow"/"deny")
// GET  ?session=…                                → SSE relay of Claude replies + permission requests
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.session !== "string") {
    return new NextResponse("session required", { status: 400 });
  }

  // Permission verdict (P4): { requestId, behavior }
  if (typeof body.requestId === "string" && (body.behavior === "allow" || body.behavior === "deny")) {
    const ok = await sendVerdict(body.session, body.requestId, body.behavior === "allow");
    return NextResponse.json({ ok });
  }

  // Push a message into the session (P2/P3): { content, source?, images? }
  if (typeof body.content === "string") {
    // Hard gate: when the experimental channel toggle is OFF, refuse pushes outright.
    // The client already won't reach here (channelConnected is forced false in the
    // turns route), but this makes "OFF means MVP" defense-in-depth — no path drives
    // a session through the channel unless the operator explicitly opted in.
    if (!isChannelEnabled()) {
      return new NextResponse("channel mode is off", { status: 409 });
    }
    const source = typeof body.source === "string" ? body.source : undefined;
    const paths = await writeChannelImages(body.images);
    const content = paths.length
      ? [body.content, ...paths.map((p) => `@${p}`)].join(" ").trim()
      : body.content;
    const ok = await pushToSession(body.session, content, { source });
    return ok ? NextResponse.json({ ok }) : new NextResponse("no live channel for session", { status: 409 });
  }

  return new NextResponse("content or verdict required", { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session");
  if (!session) {
    // List active channel sessions. Secrets stripped — the browser addresses a
    // channel by id; lib/channel resolves id→port/token server-side.
    const channels = listChannels().map(({ id, cwd, pid, startedAt }) => ({ id, cwd, pid, startedAt }));
    return NextResponse.json({ channels });
  }
  const stream = await channelEvents(session, req.signal);
  if (!stream) return new NextResponse("no live channel for session", { status: 404 });
  return new NextResponse(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

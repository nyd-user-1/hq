import { streamSignature } from "@/lib/transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events tail of a session. Polls a cheap change-signature (the
// transcript's byte size when pinned; the newest mtime across all sessions when
// not) and emits a `change` event whenever it moves. The client refetches the
// parsed turns on each change — so this works for sessions driven by ANOTHER
// physical terminal too (watch it stream live), and unpinned mode follows a
// send's forked transcript automatically.
export async function GET(req: Request) {
  const pinned = new URL(req.url).searchParams.get("session");
  const encoder = new TextEncoder();
  let poll: ReturnType<typeof setInterval> | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
    poll = beat = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          stop();
        }
      };
      send("event: ready\ndata: 1\n\n");
      let last = streamSignature(pinned);
      poll = setInterval(() => {
        const sig = streamSignature(pinned);
        if (sig !== last) {
          last = sig;
          send(`event: change\ndata: ${sig}\n\n`);
        }
      }, 500);
      beat = setInterval(() => send(": keep-alive\n\n"), 15000);
    },
    cancel: stop,
  });

  req.signal.addEventListener("abort", stop);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

import { streamSignature } from "@/lib/transcript";
import { onProjectsChange } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events tail of a session. Now fs.watch-driven (was a 500ms poll):
// the OS pushes the instant a transcript byte lands, so the change check runs only
// when the disk actually moved — instant during a turn, idle otherwise. Emits a
// `change` event whenever the signature moves — the transcript's byte size when
// pinned, the newest mtime across all sessions when not — so it works for sessions
// driven by ANOTHER physical terminal too, and unpinned mode follows a send's
// forked transcript automatically. A slow backstop interval covers any missed
// watch event; the client refetches the parsed turns on each change.
export async function GET(req: Request) {
  const pinned = new URL(req.url).searchParams.get("session");
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let backstop: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    unsub?.();
    unsub = null;
    if (beat) clearInterval(beat);
    if (backstop) clearInterval(backstop);
    if (debounce) clearTimeout(debounce);
    beat = backstop = null;
    debounce = null;
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
      const check = () => {
        const sig = streamSignature(pinned);
        if (sig !== last) {
          last = sig;
          send(`event: change\ndata: ${sig}\n\n`);
        }
      };
      const onChange = () => {
        if (debounce) return; // coalesce a burst; keep the tail snappy
        debounce = setTimeout(() => {
          debounce = null;
          check();
        }, 150);
      };
      unsub = onProjectsChange(onChange);
      backstop = setInterval(check, 30000); // safety net if a watch event is missed
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

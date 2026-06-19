import { streamSignature } from "@/lib/transcript";
import { onProjectsChange } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fs.watch-driven SSE for the Firehose panel — the event-driven replacement for
// its old 1.5s RefreshWhile timer. Emits a `change` event whenever the watched
// session's transcript signature moves, pushed by the OS the instant a turn lands
// (no idle polling). The watcher burst is debounced (the firehose re-render is a
// touch heavy), and a slow backstop interval covers any missed FS event. The
// client (RefreshOnChange) re-renders the server component on each `change`.
//
// Signature semantics mirror /api/terminal/stream: pinned ⇒ that transcript's byte
// size; unpinned ⇒ newest mtime across all sessions (so it follows the current
// session and a send's forked transcript automatically).
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
        if (debounce) return; // coalesce a streaming burst into ~1 re-render/800ms
        debounce = setTimeout(() => {
          debounce = null;
          check();
        }, 800);
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

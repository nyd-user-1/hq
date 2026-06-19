import { getRecentSessions } from "@/lib/sessions";
import { onProjectsChange } from "@/lib/watcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fs.watch-driven SSE for the sidebar Recents — replaces the 15s client poll of
// /api/sessions. Pushes the full recent-sessions payload on connect, then again
// whenever a transcript changes (debounced, since recomputing the list scans many
// files). A 45s backstop covers any missed FS event; a heartbeat keeps the
// connection open. Idle cost is now zero re-scans; activity drives ~1 push/1.2s.
export async function GET(req: Request) {
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
      const push = () => {
        try {
          const sessions = getRecentSessions(24);
          send(`event: sessions\ndata: ${JSON.stringify({ sessions })}\n\n`);
        } catch {
          // transient read (e.g. a file vanished mid-scan) — next tick retries
        }
      };
      push(); // initial snapshot, so the list paints immediately
      const onChange = () => {
        if (debounce) return;
        debounce = setTimeout(() => {
          debounce = null;
          push();
        }, 1200);
      };
      unsub = onProjectsChange(onChange);
      backstop = setInterval(push, 45000);
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

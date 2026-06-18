import { subscribe } from "@/lib/repl";

export const dynamic = "force-dynamic";

// SSE feed of a REPL's live events (init, streaming tokens, tool calls, results,
// hq_permission asks, exit). subscribe() replays the buffered events first so a
// freshly-opened browser catches up, then streams live.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session");
  if (!id) return new Response("session required", { status: 400 });

  const encoder = new TextEncoder();
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const write = (e: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ }
      };
      unsub = subscribe(id, write);
      ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { /* closed */ }
      }, 15000);
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

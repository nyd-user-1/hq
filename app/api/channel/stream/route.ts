import { channelStreamTarget } from "@/lib/channel";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SSE proxy: the browser subscribes here (no secret), and HQ relays the sidecar's
// /events stream (permission asks the classifier escalated, auto-decisions, channel
// acks, a "ready" signal). The secret stays server-side — the browser never hits
// 3003 directly. If the sidecar is down, we emit one "disconnected" event and close.
export async function GET() {
  const { url, secret } = channelStreamTarget();
  const encoder = new TextEncoder();

  if (!secret) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ kind: "disconnected", reason: "no secret" })}\n\n`),
        );
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, {
      headers: { accept: "text/event-stream" },
      // Don't cap the upstream read — it's a long-lived SSE stream.
      signal: undefined,
    });
  } catch {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ kind: "disconnected", reason: "sidecar down" })}\n\n`),
        );
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ kind: "disconnected", reason: `sidecar ${status}` })}\n\n`),
        );
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  }

  // Pipe the upstream SSE bytes straight through to the browser.
  return new Response(upstream.body, { headers: sseHeaders() });
}

function sseHeaders() {
  return {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  };
}

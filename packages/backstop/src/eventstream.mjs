// AWS event-stream (vnd.amazon.eventstream) → Anthropic SSE.
//
// Classic Bedrock's invoke-with-response-stream returns binary framed messages
// rather than SSE. Each frame:
//   [4B total length][4B headers length][4B prelude CRC][headers][payload][4B CRC]
// The payload is JSON of the form {"bytes": "<base64 of the SSE event JSON>"}.
//
// CRCs are not verified: the transport is TLS to AWS, and a corrupt frame fails
// the JSON parse below anyway.

/**
 * Returns { push(chunk), done() } — push raw bytes, receive decoded event objects.
 * Frames that fail to parse are skipped rather than killing the stream.
 */
export function createEventStreamDecoder(onEvent) {
  let buf = Buffer.alloc(0);
  return {
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      // 16 = 12B prelude + 4B trailing CRC, the smallest possible frame.
      while (buf.length >= 16) {
        const total = buf.readUInt32BE(0);
        if (total < 16 || total > 64 * 1024 * 1024) {
          buf = Buffer.alloc(0); // desynced beyond recovery
          return;
        }
        if (buf.length < total) return;
        const headersLen = buf.readUInt32BE(4);
        const payload = buf.subarray(12 + headersLen, total - 4);
        buf = buf.subarray(total);
        try {
          const outer = JSON.parse(payload.toString("utf8"));
          if (typeof outer.bytes === "string") {
            onEvent(JSON.parse(Buffer.from(outer.bytes, "base64").toString("utf8")));
          } else if (outer.message || outer.Message) {
            onEvent({ type: "error", error: { type: "api_error", message: outer.message ?? outer.Message } });
          }
        } catch {
          /* skip unparseable frame */
        }
      }
    },
    done() {
      buf = Buffer.alloc(0);
    },
  };
}

/** Serialize a decoded event object as an Anthropic SSE frame. */
export function toSse(event) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Build an event-stream frame — used by the test harness to fake Bedrock. */
export function encodeEventStreamFrame(eventObject) {
  const inner = Buffer.from(JSON.stringify(eventObject), "utf8").toString("base64");
  const payload = Buffer.from(JSON.stringify({ bytes: inner }), "utf8");
  const headers = Buffer.alloc(0);
  const total = 12 + headers.length + payload.length + 4;
  const frame = Buffer.alloc(total);
  frame.writeUInt32BE(total, 0);
  frame.writeUInt32BE(headers.length, 4);
  frame.writeUInt32BE(0, 8); // prelude CRC (unverified)
  payload.copy(frame, 12 + headers.length);
  frame.writeUInt32BE(0, total - 4); // message CRC (unverified)
  return frame;
}

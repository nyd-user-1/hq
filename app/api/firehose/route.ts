import { firehoseFor } from "@/lib/firehose";

// Reads the session transcript tail off disk — never cache.
export const dynamic = "force-dynamic";

// GET — the Firehose everything-view of a session's transcript as structured
// items (the same data the @panel/(console)/firehose route renders, served as
// JSON for the standalone push-in panel). ?session=<id> pins one; default =
// the current/newest session (firehoseFor → latestSessionId). The live tail is
// driven by the sibling /api/firehose/stream SSE; the client re-fetches this on
// each `change`.
export async function GET(req: Request) {
  const session = new URL(req.url).searchParams.get("session");
  return Response.json(firehoseFor(session));
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Event-driven sibling of RefreshWhile: instead of re-rendering the server
// component on a fixed timer, it subscribes to the fs.watch-backed SSE and calls
// router.refresh() only when the watched session's transcript actually changes —
// instant during a live turn, zero work when idle. EventSource auto-reconnects on
// drop, and the route's own backstop covers any missed FS event.
export default function RefreshOnChange({
  session,
}: {
  session?: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    const url = session
      ? `/api/firehose/stream?session=${encodeURIComponent(session)}`
      : "/api/firehose/stream";
    const es = new EventSource(url);
    es.addEventListener("change", () => router.refresh());
    return () => es.close();
  }, [session, router]);
  return null;
}

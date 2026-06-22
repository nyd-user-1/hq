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
    // CODE-REVIEW FE-7: trailing debounce so a transcript WRITE STORM (many
    // `change` events in quick succession) collapses to ONE router.refresh()
    // instead of a burst of full RSC refreshes. ~250ms feels instant but coalesces.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 250);
    };
    es.addEventListener("change", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [session, router]);
  return null;
}

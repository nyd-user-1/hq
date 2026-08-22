"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { withPins } from "@/app/ui/keep-pins";

/**
 * A session-id chip inside a chat reply. The label copies (the old behaviour —
 * muscle memory intact); the ↗ that fades in on hover OPENS the session in the
 * reader panel, terminal still running beside it.
 *
 * This exists because a session id in a reply used to be a dead end: you could
 * copy it, but the only way to actually read it was to hand-type
 * /search?openSession=<id> into the address bar — which is not a thing anyone
 * should have to do from inside the app. Works for swept sessions too: the
 * reader falls back to the retained index text (see lib/archive.ts).
 */
export default function SessionLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [href, setHref] = useState(`/search?openSession=${id}`);

  // Carry ?session/?wall/?lead so opening this never resets Terminal 1.
  useEffect(() => {
    // withPins returns "/search" when there are no pins to carry, so key the
    // separator off what it actually returned — not off the current URL.
    const base = withPins("/search", window.location.search);
    setHref(`${base}${base.includes("?") ? "&" : "?"}openSession=${id}`);
  }, [id]);

  return (
    <span className="group/sess inline-flex items-center gap-0.5 rounded bg-zinc-800 py-0.5 pl-1 pr-0.5 align-baseline font-mono text-[0.95em]">
      <button
        type="button"
        title="copy session id"
        onClick={() => {
          navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className={`cursor-pointer transition-colors ${
          copied ? "text-emerald-300" : "text-blue-400 hover:text-blue-300"
        }`}
      >
        {id.slice(0, 8)}
      </button>
      <Link
        href={href}
        scroll={false}
        title="open this session in the panel"
        aria-label="Open this session"
        className="rounded px-0.5 text-zinc-500 opacity-0 transition hover:text-blue-300 focus:opacity-100 group-hover/sess:opacity-100"
      >
        ↗
      </Link>
    </span>
  );
}

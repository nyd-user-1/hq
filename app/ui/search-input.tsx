"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// Search-as-you-type. Debounced keystrokes drive router.replace so the server page
// re-runs the search while this input (client state) keeps focus and value. The
// nav runs inside a transition, so `isPending` lights a small pulse while results
// stream in (the tariffs "fade while loading" cue, kept honest and local).
//
// Paste is handled explicitly — the old input dropped pasted text, so rather than
// trust the native paste→onChange path we splice the clipboard string in at the
// caret ourselves and re-place the cursor. `type="text"` (not "search") avoids the
// native ✕ and its quirks; we render our own clear control.
export default function SearchInput({
  initial,
  scope,
  sort,
  pins = "",
}: {
  initial: string;
  scope: string;
  sort: string;
  // "session=…&pair=…" — carried so typing never drops the terminal pins (which
  // would un-pin the terminal and wipe the search via its re-pin).
  pins?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(initial); // the last query we pushed to the URL

  const go = (q: string) => {
    sent.current = q;
    startTransition(() =>
      router.replace(
        `/search?q=${encodeURIComponent(q)}&scope=${scope}&sort=${sort}${
          pins ? `&${pins}` : ""
        }`,
        { scroll: false }
      )
    );
  };
  const debounce = (q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(q), 160);
  };
  const update = (v: string) => {
    setValue(v);
    debounce(v);
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    go("");
    inputRef.current?.focus();
  };

  // Adopt external query changes (back/forward, a scope switch that keeps q, a
  // cleared URL) WITHOUT clobbering what's being typed: sync only when the incoming
  // prop differs from the last value we ourselves sent.
  useEffect(() => {
    if (initial !== sent.current) {
      setValue(initial);
      sent.current = initial;
    }
  }, [initial]);

  // "/" focuses search from anywhere you aren't already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="group relative">
      <svg
        aria-hidden
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        name="q"
        value={value}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        aria-label="Search HQ"
        placeholder="Search everything HQ has seen…"
        onChange={(e) => update(e.target.value)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (!t) return; // non-text payload → let the browser's default run
          e.preventDefault();
          const el = e.currentTarget;
          const s = el.selectionStart ?? value.length;
          const en = el.selectionEnd ?? value.length;
          const next = value.slice(0, s) + t + value.slice(en);
          update(next);
          const caret = s + t.length;
          requestAnimationFrame(() => el.setSelectionRange(caret, caret));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (timer.current) clearTimeout(timer.current);
            go(value);
          } else if (e.key === "Escape" && value) {
            e.preventDefault();
            clear();
          }
        }}
        className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-1.5 pl-9 pr-9 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
      />
      {isPending && value && (
        <span
          aria-hidden
          className="absolute right-9 top-1/2 h-1.5 w-1.5 -translate-y-1/2 animate-pulse rounded-full bg-zinc-500"
        />
      )}
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

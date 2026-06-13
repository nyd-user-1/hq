"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Claude-style "Recents": a live list of recent Claude Code sessions, newest
// first. Clicking one pins the center terminal to it (?session=<id>) without
// moving the panel — the same switch the session cards do, but always at hand.
type Recent = {
  id: string;
  project: string;
  title: string;
  lastActive: number;
  active: boolean;
};

export default function SidebarRecents() {
  const pathname = usePathname() ?? "/";
  const current = useSearchParams().get("session");
  const [sessions, setSessions] = useState<Recent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await (await fetch("/api/sessions")).json();
        if (alive) {
          setSessions(d.sessions ?? []);
          setLoaded(true);
        }
      } catch {
        // transient (dev recompile) — the interval picks it back up
      }
    };
    load();
    const t = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (loaded && !sessions.length)
    return <p className="px-2.5 text-xs text-zinc-600">no recent sessions</p>;

  return (
    <ul className="scrollbar-none flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {sessions.map((s) => {
        const active = current === s.id;
        return (
          <li key={s.id}>
            <Link
              href={`${pathname}?session=${s.id}`}
              scroll={false}
              title={`${s.project} · ${s.title}`}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              }`}
            >
              {/* green = active within the cache window (one app-wide signal) */}
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  s.active ? "bg-green-500" : "bg-transparent"
                }`}
              />
              <span className="truncate">{s.title}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

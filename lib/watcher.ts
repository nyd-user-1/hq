import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";

// ONE shared recursive fs.watch over ~/.claude/projects, surfaced as a debounced
// "change" event. Every live SSE route subscribes to this single watcher instead
// of each polling the disk on a timer — the OS (FSEvents on macOS) pushes the
// instant a transcript is appended or a new session file appears. HQ is
// localhost-only, Node runtime, one process, so a module singleton is shared
// across all route handlers. Import ONLY from `runtime = "nodejs"` routes.
//
// Resilience: the watcher lazily starts on the first subscriber and stops when the
// last one leaves; on a watch error it re-arms; if it can't start at all (no dir,
// a platform without recursive watch), subscribers simply never get pushes and
// fall back to their own slow backstop interval — so a dead watcher degrades to
// "a little less instant", never to "broken".
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");
const DEBOUNCE_MS = 120; // coalesce a burst of raw FS events into one tick

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // many concurrent SSE connections subscribe

let watcher: fs.FSWatcher | null = null;
let started = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

function fire(): void {
  if (debounce) return; // already a tick scheduled — coalesce into it
  debounce = setTimeout(() => {
    debounce = null;
    emitter.emit("change");
  }, DEBOUNCE_MS);
}

function rearm(): void {
  try {
    watcher?.close();
  } catch {
    /* already gone */
  }
  watcher = null;
  started = false;
  // a subscriber is presumably still connected — restart shortly
  setTimeout(() => {
    if (emitter.listenerCount("change") > 0) start();
  }, 1000);
}

function start(): void {
  if (started) return;
  started = true;
  try {
    watcher = fs.watch(PROJECTS_ROOT, { recursive: true, persistent: false }, fire);
    watcher.on("error", rearm);
  } catch {
    // no projects dir / no recursive watch here — let subscribers' backstop carry
    started = false;
  }
}

// Subscribe to debounced change ticks; returns an unsubscribe fn. Starts the
// watcher on the first subscriber and stops it when the last one unsubscribes.
export function onProjectsChange(cb: () => void): () => void {
  emitter.on("change", cb);
  start();
  return () => {
    emitter.off("change", cb);
    if (emitter.listenerCount("change") === 0) {
      try {
        watcher?.close();
      } catch {
        /* already gone */
      }
      watcher = null;
      started = false;
      if (debounce) {
        clearTimeout(debounce);
        debounce = null;
      }
    }
  };
}

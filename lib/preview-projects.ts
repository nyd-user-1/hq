import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import { listLaunchProjects } from "./sessions";

// The universal project list for the Preview panel. The SET of projects comes
// from listLaunchProjects() — session cwds ∪ the configured projectsRoot, the
// same Claude-Code-native source the new-session chips use (NOT a hardcoded
// ~/code glob, so it works for any user). The URL per project is inferred from
// its package.json dev script, with a persisted per-project override on top.
const OVERRIDES = path.join(os.homedir(), ".claude", "hq", "preview-urls.json");

export type PreviewProject = {
  name: string;
  path: string;
  url: string | null; // inferred or overridden localhost dev URL (null = unknown)
  framework: string | null;
  source: "override" | "inferred" | null;
  live: boolean; // is the URL's port answering right now?
};

// Framework command → default dev port, used when the dev script doesn't pin one.
const FRAMEWORK_PORT: Record<string, number> = {
  next: 3000,
  nuxt: 3000,
  vite: 5173,
  astro: 4321,
  remix: 3000,
  gatsby: 8000,
  "react-scripts": 3000,
  craco: 3000,
  ng: 4200, // angular
  "vue-cli-service": 8080,
};

function readOverrides(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDES, "utf8"));
  } catch {
    return {};
  }
}

// Persist (or clear, when url is blank) a per-project URL override, keyed by the
// project's canonical path.
export function setPreviewOverride(projectPath: string, url: string): void {
  const all = readOverrides();
  if (url.trim()) all[projectPath] = url.trim();
  else delete all[projectPath];
  fs.mkdirSync(path.dirname(OVERRIDES), { recursive: true });
  fs.writeFileSync(OVERRIDES, JSON.stringify(all, null, 2));
}

// Infer a localhost dev URL from a project's package.json dev (or start) script.
function inferDevUrl(dir: string): { url: string | null; framework: string | null } {
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return { url: null, framework: null };
  }
  const script = pkg?.scripts?.dev || pkg?.scripts?.start || "";
  if (!script) return { url: null, framework: null };
  // explicit port wins: -p 3002 / -p=3002 / --port 5173 / --port=5173 / PORT=3000
  const explicit =
    script.match(/(?:-p|--port)[=\s]+(\d{2,5})/)?.[1] ||
    script.match(/\bPORT[=\s]+(\d{2,5})/)?.[1];
  const framework =
    Object.keys(FRAMEWORK_PORT).find((k) => new RegExp(`\\b${k}\\b`).test(script)) ?? null;
  const port = explicit ? Number(explicit) : framework ? FRAMEWORK_PORT[framework] : null;
  return { url: port ? `http://localhost:${port}` : null, framework };
}

// Is something serving on this localhost port? A short TCP connect — fast and
// reliable (vs. an HTTP fetch), and it can't be fooled by app-level CORS guards.
function portLive(port: number, timeout = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
    sock.connect(port, "127.0.0.1");
  });
}

function portOf(url: string | null): number | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  } catch {
    return null;
  }
}

export async function previewProjects(): Promise<PreviewProject[]> {
  const overrides = readOverrides();
  const rows = listLaunchProjects().map((p) => {
    const override = overrides[p.path];
    const inferred = inferDevUrl(p.path);
    const url = override || inferred.url;
    return {
      name: p.name,
      path: p.path,
      url,
      framework: inferred.framework,
      source: (override ? "override" : inferred.url ? "inferred" : null) as PreviewProject["source"],
      port: portOf(url),
    };
  });
  // Check each UNIQUE port once (many `next dev` projects share :3000), in parallel.
  const ports = [...new Set(rows.map((r) => r.port).filter((x): x is number => x != null))];
  const liveMap = new Map<number, boolean>();
  await Promise.all(ports.map(async (port) => liveMap.set(port, await portLive(port))));
  return rows.map(({ port, ...r }) => ({ ...r, live: port != null && !!liveMap.get(port) }));
}

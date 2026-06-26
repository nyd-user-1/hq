import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

// hq-managed dev servers for the Preview panel. SINGLE-SLOT: at most one server
// hq has started at a time — starting a new project pushes out the previous one
// (previewing is one-at-a-time, so this caps resource use BY DESIGN, no footgun).
// hq only ever touches servers IT started; a dev server you started yourself is
// detected as already-live and reused, never killed. Spawned detached so it
// survives an hq (Next) HMR restart; the last one is recorded in a sidecar so a
// restarted hq can still see + stop it (by pid).
const SIDECAR = path.join(os.homedir(), ".claude", "hq", "dev-servers.json");

// A PATH that finds npm/node regardless of how hq was launched. A GUI-launched
// app (the packaged desktop bundle) inherits a MINIMAL PATH — no homebrew, no
// npm-global — so `spawn("npm")` would die instantly ("exited during startup").
// Prepend the usual node homes (npm global, both homebrew prefixes, system).
const EXTRA_PATH = [
  path.join(os.homedir(), ".npm-global", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

export type Managed = {
  projectPath: string;
  name: string;
  port: number;
  url: string;
  pid: number;
  startedAt: number;
};

// In-process handle for the current child (logs + a direct kill). Lost across an
// hq restart, but the sidecar keeps {pid,port} so we can still reconcile + stop.
let current: { child: ChildProcess; info: Managed; log: string[] } | null = null;

function portLive(port: number, timeout = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeout);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, "127.0.0.1");
  });
}

// An OS-assigned free localhost port — for static sites (bankit) that have no
// dev script and thus no inferred port to target.
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(0));
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const p = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

// The project's serve command: its package.json dev/start script via npm, else a
// static server for a plain index.html site (e.g. bankit). null = can't serve.
function serveCommand(projectPath: string, port: number): { cmd: string; args: string[] } | null {
  let pkg: { scripts?: Record<string, string> } | null = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"));
  } catch {
    /* no package.json */
  }
  if (pkg?.scripts?.dev) return { cmd: "npm", args: ["run", "dev"] };
  if (pkg?.scripts?.start) return { cmd: "npm", args: ["run", "start"] };
  if (fs.existsSync(path.join(projectPath, "index.html")))
    return { cmd: "python3", args: ["-m", "http.server", String(port), "--directory", projectPath] };
  return null;
}

function readSidecar(): Managed | null {
  try {
    return JSON.parse(fs.readFileSync(SIDECAR, "utf8"));
  } catch {
    return null;
  }
}

function persist(info: Managed | null) {
  try {
    fs.mkdirSync(path.dirname(SIDECAR), { recursive: true });
    fs.writeFileSync(SIDECAR, JSON.stringify(info));
  } catch {
    /* best effort */
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

export function stopDevServer(): void {
  // kill via the in-process handle if we have it, else by the sidecar pid (e.g.
  // after an hq restart). detached children are their own process group, so a
  // negative pid signals the whole group.
  const pid = current?.info.pid ?? readSidecar()?.pid;
  if (current?.child && !current.child.killed) {
    try {
      current.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  } else if (pid && pid > 0 && pidAlive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }
  }
  current = null;
  persist(null);
}

export type StartResult = { ok: true; url: string } | { ok: false; error: string; log?: string };

// Start (or reuse) a dev server for the project; resolve once its port answers.
export async function startDevServer(
  projectPath: string,
  name: string,
  port: number,
): Promise<StartResult> {
  // static sites have no inferred port → assign a free one.
  if (!port) port = await freePort();
  if (!port) return { ok: false, error: "Couldn't find a free port." };
  const url = `http://localhost:${port}`;
  // already serving (your own server, or a prior hq one)? reuse — touch nothing.
  if (await portLive(port)) return { ok: true, url };

  stopDevServer(); // single-slot: push out hq's previous one

  const sc = serveCommand(projectPath, port);
  if (!sc) return { ok: false, error: "No dev/start script and no index.html — set a URL manually." };

  // Strip HQ's OWN Next.js env before spawning the child. When HQ runs as the
  // packaged desktop standalone, process.env carries NODE_ENV=production + Next's
  // private standalone config — inheriting those POISONS a spawned `next dev`
  // ("non-standard NODE_ENV", "Invalid distDirRoot" Turbopack panic). The child
  // must start from a clean slate so it boots as its OWN project, not inside HQ's.
  const childEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "NODE_ENV" || k === "HQ_BUILD_DIR" || k.startsWith("__NEXT") || k.startsWith("NEXT_PRIVATE"))
      continue;
    childEnv[k] = v;
  }

  const log: string[] = [];
  let child: ChildProcess;
  try {
    child = spawn(sc.cmd, sc.args, {
      cwd: projectPath,
      env: {
        ...childEnv,
        // childEnv already dropped HQ's NODE_ENV + Next internals; force the child
        // to development (what `next dev` wants — and it satisfies the type, which
        // augments ProcessEnv to require NODE_ENV).
        NODE_ENV: "development",
        PATH: `${EXTRA_PATH}:${process.env.PATH ?? ""}`,
        PORT: String(port),
        BROWSER: "none",
        FORCE_COLOR: "0",
      },
      detached: true, // own process group → survives an hq restart, killable as a group
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    return { ok: false, error: `Failed to spawn: ${(e as Error).message}` };
  }
  const onLog = (d: Buffer) => {
    log.push(d.toString());
    if (log.length > 200) log.shift();
  };
  child.stdout?.on("data", onLog);
  child.stderr?.on("data", onLog);
  child.unref();

  const info: Managed = { projectPath, name, port, url, pid: child.pid ?? -1, startedAt: Date.now() };
  current = { child, info, log };
  persist(info);

  // dev servers take a few seconds to compile — poll the port until it answers.
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (exited) return { ok: false, error: "Dev server exited during startup.", log: log.join("").slice(-2000) };
    if (await portLive(port)) return { ok: true, url };
    await new Promise((r) => setTimeout(r, 600));
  }
  return { ok: false, error: "Timed out waiting for the dev server to come up.", log: log.join("").slice(-2000) };
}

// Current hq-managed server, reconciled with reality (the process must be alive).
export function devServerStatus(): (Managed & { byThisProcess: boolean }) | null {
  const info = current?.info ?? readSidecar();
  if (!info) return null;
  if (info.pid > 0 && !pidAlive(info.pid)) {
    if (!current) persist(null);
    return null;
  }
  return { ...info, byThisProcess: !!current };
}

export function devServerLog(): string {
  return current?.log.join("") ?? "";
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // distDir defaults to ".next" — used by `next dev`, Vercel, and the shipped
  // build. `npm run build:check` sets HQ_BUILD_DIR=.next-build so a local
  // pre-push verification build compiles into a SEPARATE dir and never clobbers
  // the .next a live `next dev` is serving from (retires the "Launchpad Rule").
  distDir: process.env.HQ_BUILD_DIR || ".next",
  // Offline launch (Door 2): emit a self-contained server bundle at
  // .next/standalone/server.js that runs under plain `node` with no install
  // and no dev toolchain. next/font/google fonts are downloaded + self-hosted
  // at build time, so the running server needs zero network. Build needs the
  // network once; the launched app does not.
  output: "standalone",
  // The repo can hold nested git worktrees under .claude/ (parallel agent lanes)
  // plus a tsbuildinfo — none of that belongs in the shipped bundle. Keep next's
  // output tracer from copying them into .next/standalone (build:offline also
  // strips them as a belt-and-suspenders guarantee).
  outputFileTracingExcludes: {
    "*": ["**/.claude/**", "**/*.tsbuildinfo"],
  },
  // DEV-ONLY anti-staleness. The recurring "old CSS until I fight the dev server"
  // bug is Safari's: `next dev` serves chunks under STABLE urls (e.g.
  // `[root-of-the-server]__….css`), and a normal ⌘R revalidates the document but
  // re-uses those subresources from cache without rechecking (only ⌘⇧R bypasses
  // it). Force `no-store` on everything in dev so the browser can't cache a chunk
  // OR bfcache the page → a plain reload always shows the latest build, no hard-
  // refresh / Disable-Caches needed. Prod is untouched (chunks stay content-hashed
  // + immutable): this returns nothing when building for production.
  async headers() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;

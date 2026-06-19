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
};

export default nextConfig;

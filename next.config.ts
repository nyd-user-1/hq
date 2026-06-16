import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // distDir defaults to ".next" — used by `next dev`, Vercel, and the shipped
  // build. `npm run build:check` sets HQ_BUILD_DIR=.next-build so a local
  // pre-push verification build compiles into a SEPARATE dir and never clobbers
  // the .next a live `next dev` is serving from (retires the "Launchpad Rule").
  distDir: process.env.HQ_BUILD_DIR || ".next",
};

export default nextConfig;

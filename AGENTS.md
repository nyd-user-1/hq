<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# HQ

Product #9: the portfolio dashboard over the HQ vault. Localhost-only — no DB, no auth, no deploy.

- **Vault join:** this repo (`~/code/hq`) ↔ `~/vaults/hq/!hq/` — design decisions and thread notes live there (thread `001 Agentic OS`). Read the latest `001.x` note before resuming work.
- **Data source:** the vault itself, via `lib/vault.ts` (plain `fs`, zero deps). Git logs and Vercel API are gray placeholders until Stage 3.
- **Architecture:** parallel routes — `app/layout.tsx` renders `children` (Portfolio) + `@activity` + `@console`, each slot navigating independently with its own `default.tsx`.

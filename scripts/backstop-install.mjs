#!/usr/bin/env node
// Shim. Backstop lives in packages/backstop and ships as @nysgpt/backstop; this
// keeps the path that AGENTS.md, the resilience tests, and every error message
// printed by an already-installed hook have been pointing at.
//
//   node scripts/backstop-install.mjs [install|doctor|status|eject]
//
// argv passes through untouched — importing runs the bin exactly as node would.
import "../packages/backstop/bin/backstop.mjs";

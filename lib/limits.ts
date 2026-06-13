// Context-window accounting. Pure constants, zero imports — safe to pull into
// BOTH the client island (terminal.tsx) and server components (sessions panel)
// without dragging node:fs into the client bundle.

// Gauge ceiling = the real context window. Brendan's default is the Opus 4.8
// *1M-context* tier, so the wall is 1,000,000 — NOT the 200k default window.
// The transcript can't tell us the tier (the per-message model is the bare
// "claude-opus-4-8" whether you launched 200k or 1M), so we trust the 1M
// default he runs. Drop this to 200_000 if you ever monitor a default-tier run.
export const CONTEXT_LIMIT = 1_000_000;

// The long-context PRICE cliff, not a capacity wall: above ~200k input tokens
// the 1M tier bills at the premium rate (~2x input). The gauge marks it so you
// can see when each turn starts costing more — it does NOT mean you're "full".
export const PRICING_CLIFF = 200_000;

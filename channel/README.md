# HQ channel (Claude Code research preview)

Lets the HQ dashboard **push events into a live Claude Code session** and, two-way,
receive Claude's replies + relay tool-permission prompts. It is an MCP "channel"
server per the [official contract](https://code.claude.com/docs/en/channels-reference).

## How it fits together

```
HQ Next app ──HTTP POST :PORT (X-HQ-Token)──▶ hq-channel.mjs ──stdio notify──▶ live session
        ◀──────── SSE  GET /events?token= ──────────  (Claude replies, permission prompts)
```

Claude Code **spawns `hq-channel.mjs` as a subprocess** (one per session, over stdio).
The subprocess also opens a **loopback HTTP port** that only the local HQ process talks to.
The MCP SDK lives in *this* sub-package, never in HQ's runtime bundle (HQ stays 3 deps).

## Why it's isolated from HQ's deps

HQ's identity is "three runtime deps" (`next`/`react`/`react-dom`). The channel runs as a
separate process Claude Code launches, so its `@modelcontextprotocol/sdk` + `zod` deps live
in `channel/package.json` and never enter HQ's bundle. Install once: `cd channel && npm install`.

## Security

- Binds `127.0.0.1` only.
- Every inbound `POST /` requires `X-HQ-Token: <secret>`; `GET /events` requires `?token=<secret>`.
- A missing `HQ_CHANNEL_TOKEN` **fails closed** (all pushes rejected).
- HQ spawns the session (`lib/repl.ts`) and passes a **per-session** `HQ_CHANNEL_PORT` +
  `HQ_CHANNEL_TOKEN` via the inherited env, so each session's channel has its own port + secret.
- The doc's warning is load-bearing: *an ungated channel is a prompt-injection vector.* The token
  gate is what makes permission relay (P4) safe to enable.

## Env

| Var | Meaning |
| --- | --- |
| `HQ_CHANNEL_PORT` | loopback port to listen on (default 8790) |
| `HQ_CHANNEL_TOKEN` | shared secret HQ must present (no default → fail closed) |
| `HQ_REPL_SESSION` | session routing key, if HQ-spawned (optional) |

## Wire protocol

- **Push (HQ → session):** `POST /` with `X-HQ-Token`. Body becomes the `<channel source="hq" chat_id="N" kind="...">BODY</channel>` event. Set `X-HQ-Source: signal|ui|todo|…` to tag `kind`.
- **Permission verdict (HQ → Claude Code):** `POST /` with body `yes <id>` / `no <id>` → applied to the open tool prompt.
- **Out (session → HQ):** subscribe `GET /events?token=…` (SSE). Frames: `{type:"reply",chat_id,text}` and `{type:"permission_request",request_id,tool_name,description,input_preview}`.

## Manual test (research preview needs the dev flag)

```bash
# from the worktree root, with a token in env:
HQ_CHANNEL_TOKEN=smoke HQ_CHANNEL_PORT=8790 \
  claude --dangerously-load-development-channels server:hq
# approve the one-time "Use this MCP server" consent.
# then, from another terminal, push into the live session:
curl -s -XPOST localhost:8790 -H "X-HQ-Token: smoke" -d "the failing test is in lib/usage.ts — focus there"
```

## Status

- **P1 (done):** server + loopback HTTP + token gate + channel push + reply tool + permission-relay handler scaffolded.
- **P2:** HQ-side `lib/channel.ts` (per-session port/token + push/subscribe), `repl.ts` spawn flag, send-box `→ live` chip + connection indicator.
- **P3:** Signals (auto-push cost-cliff/CI/commit/todo).
- **P4:** permission relay surfaced in the HQ UI, composed with `lib/permission-policy.ts`.

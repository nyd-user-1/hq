# @nysgpt/backstop

You hit your usage limit mid-sprint. Every open session freezes. The reset is
three hours out, and the thing you most need is to ask what just happened —
which is exactly the thing you can no longer do.

Type `/backstop`. The sessions keep going.

```
npx @nysgpt/backstop
```

macOS. Node 22.5+. No dependencies.

## What it actually does

`ANTHROPIC_BASE_URL` in `settings.json` points every new session at a local
daemon on `127.0.0.1:3141`. Normally that daemon is a pass-through: your traffic
goes to Anthropic on your own plan, and nothing about your setup has changed.

At the wall, `/backstop` flips it. The same sessions — same context, same
history, same terminal — start serving from other capacity (AWS Bedrock today)
until you flip it back, close the terminal, or your plan resets.

No restart. No `--resume`. No lost context. That is the entire product.

It works at the wall because it never asks the model anything: `/backstop` is a
`UserPromptSubmit` hook, so it runs client-side and blocks the prompt before it
reaches an API that is currently refusing you. Zero tokens.

## Commands

| | |
|---|---|
| `/backstop` | engage — or release, if already engaged |
| `/backstop status` | what's on, what it's drawn |
| `/reload-5` `/reload-10` `/reload-20` | add budget without leaving the terminal |
| `npx @nysgpt/backstop doctor` | check every invariant that can take the account down |
| `npx @nysgpt/backstop eject` | remove it completely |

On and off are one yellow line each. Nothing else prints.

## It is not automatic, and that is deliberate

Presence is consent. An automatic flip means an unattended agent can decide, at
3am, to spend your money on a runaway loop — the usage wall is the only circuit
breaker you have, and this would remove it. You are at the keyboard when you
type `/backstop`, or it does not happen.

Every pass also carries a hard ceiling on provider spend. When the ceiling is
hit, backstop releases itself rather than continuing to bill.

## Read this before installing

**This puts a local daemon in the request path of every session on the machine.**
When port 3141 is dead, none of the fail-open logic runs — there is no code to
run — and every session dies with `ConnectionRefused` until a human finds it.
That shipped once and cost two days of a locked-out account.

Three things hold the line, and `doctor` verifies all of them:

1. **The plist lives in `~/Library/LaunchAgents`.** `launchctl bootstrap` from
   anywhere else is forgotten at logout, so a reboot silently drops the job —
   KeepAlive included. This is the bug that caused the lockout.
2. **The daemon runs from a snapshot in `~/.claude/hq/backstop/`, never from a
   source checkout.** Otherwise a `git checkout`, a rename, or a half-saved edit
   crash-loops it and takes every session down with it.
3. **An unrevivable gateway disarms itself.** A `SessionStart` hook tries to
   revive it, and failing that removes `ANTHROPIC_BASE_URL` — so the *next*
   session is a working session no matter what.

If `doctor` exits non-zero, the account is at risk right now, and it names the
one command that fixes it.

Testing? Set `CLAUDE_CONFIG_DIR` to a scratch directory and `HQ_BACKSTOP_PORT`
to something other than 3141. Every install artifact — plist label, hooks,
runtime, commands — follows both, so a test cannot touch your real account.
Without that, a "test" rewrites your primary `settings.json`, which is precisely
how this got shipped broken the first time.

## Proving it

```
node scripts/backstop-selftest.mjs     # it serves
node scripts/backstop-resilience.mjs   # a broken backstop cannot take the account down
node scripts/backstop-billing-test.mjs # nobody gets capacity they didn't pay for
```

The middle one is the one that matters.

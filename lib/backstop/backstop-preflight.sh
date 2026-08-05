#!/bin/bash
# SessionStart hook — the floor under a dead gateway.
#
# Every session on this machine is born pointing at 127.0.0.1:PORT. If nothing
# is listening there then NONE of our code is in the request path — no
# fail-open, no fallback, no breaker can run — and every turn dies with
# ConnectionRefused until a human finds it. That is exactly what happened: a
# reboot dropped the launchd job and the account was unusable for two days.
#
# This hook runs client-side at session birth, before the first request, and
# guarantees one of two outcomes:
#
#   1. the gateway is answering, or
#   2. backstop removes itself from the path (see disarm.mjs)
#
# There is no third outcome where the account stays down.
#
# Exit 0 -> healthy or revived; stdout JSON becomes model context.
# Exit 2 -> disarmed; stderr is shown to the user in the transcript, which is
#           the only channel that still works when the API is refusing.

CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PORT="${HQ_BACKSTOP_PORT:-$(cat "$CFG/hq/backstop/port" 2>/dev/null || echo 3141)}"
HEALTH="http://127.0.0.1:${PORT}/_backstop/health"
# One daemon per port — a test install on another port has its own label, so
# this hook can never restart or disarm the wrong account's gateway.
if [ "$PORT" = "3141" ]; then LABEL="com.hq.backstop"; else LABEL="com.hq.backstop.${PORT}"; fi
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DISARM="$CFG/hq/backstop/disarm.mjs"
SETTINGS="$CFG/settings.json"
ME=$(id -u)

# Not routed through us? Then this is a normal direct session and there is
# nothing to guard. Also the post-disarm steady state, so a disarmed machine
# never nags again.
grep -q "127\.0\.0\.1:${PORT}" "$SETTINGS" 2>/dev/null || exit 0

alive() { curl -sf --max-time 2 "$HEALTH" >/dev/null 2>&1; }

# Fast path — a few ms on a healthy machine, which is every normal start.
alive && exit 0

# Down. Try to bring it back before giving up on it. `kickstart` restarts a
# loaded job; `bootstrap` loads one that was never registered (the post-reboot
# case). Whichever is wrong for the current state fails harmlessly.
launchctl kickstart -k "gui/${ME}/${LABEL}" 2>/dev/null
[ -f "$PLIST" ] && launchctl bootstrap "gui/${ME}" "$PLIST" 2>/dev/null

# The gateway binds in ~200ms; 3s is generous headroom on a cold boot.
for _ in $(seq 1 15); do
  if alive; then
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"backstop: gateway was down at session start and was restarted automatically. This session is healthy. Worth checking `node scripts/backstop-install.mjs --doctor` for why it stopped."}}\n'
    exit 0
  fi
  sleep 0.2
done

# Unrecoverable. Get out of the request path so the NEXT session is a working
# session, and tell the user in the one place they will actually see it.
node "$DISARM" "gateway unreachable at session start" >/dev/null 2>&1
disarmed=$?

if [ "$disarmed" -eq 0 ]; then
  cat >&2 <<EOF

  backstop: the gateway on 127.0.0.1:${PORT} is not answering and could not be restarted.

  Backstop has removed itself from the request path so it cannot hold the
  account hostage. THIS session is still pointed at the dead port and will
  fail — open a new terminal window and it will go straight to the API.

  Diagnose:  node scripts/backstop-install.mjs --doctor
  Remove:    node scripts/backstop-install.mjs --eject

EOF
else
  cat >&2 <<EOF

  backstop: the gateway on 127.0.0.1:${PORT} is not answering, and settings.json
  could not be edited to remove it. Every session will fail until you run:

      node scripts/backstop-install.mjs --eject

EOF
fi

exit 2

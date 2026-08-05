#!/bin/bash
# UserPromptSubmit hook for /backstop.
#
# Fires client-side the instant the prompt is submitted, BEFORE any request
# reaches the API — which is what makes it work at the wall, where the model
# cannot answer. It flips the gateway and blocks the prompt, so the whole
# interaction costs zero tokens and prints one line in the terminal.
#
# Exit 2 = block the prompt; stderr is shown to the user.
IN=$(cat)

# Extract the prompt field from the hook payload.
prompt=$(printf '%s' "$IN" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)"[^"]*}[[:space:]]*$/\1/p')
[ -z "$prompt" ] && prompt=$(printf '%s' "$IN" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Only the literal command, at the very start of the prompt. Anything else —
# talking *about* backstop, a file that mentions it — must pass through
# untouched, or the hook would eat ordinary conversation.
case "$prompt" in
  /backstop|/backstop\ *|/backstop\\n*) args=${prompt#/backstop} ;;
  # /reload-N tops up the pass from the terminal. It only exists as its own
  # command because the moment it is needed — mid-sprint, out of budget — is the
  # worst possible moment to go looking for a dashboard.
  /reload-5|/reload-5\ *|/reload-5\\n*) args="reload-5" ;;
  /reload-10|/reload-10\ *|/reload-10\\n*) args="reload-10" ;;
  /reload-20|/reload-20\ *|/reload-20\\n*) args="reload-20" ;;
  *) exit 0 ;;
esac

CTL="${HQ_BACKSTOP_CTL:-$HOME/.claude/hq/backstop/backstop-ctl.sh}"
[ -x "$CTL" ] || CTL="$HOME/.claude/hq/backstop-ctl.sh"

if [ -x "$CTL" ]; then
  "$CTL" "$args" >&2 2>&1
else
  echo "backstop: control script missing at $CTL — reinstall with: node scripts/backstop-install.mjs" >&2
fi

exit 2

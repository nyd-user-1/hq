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
  /backstop|/backstop\ *|/backstop\\n*) ;;
  *) exit 0 ;;
esac

args=${prompt#/backstop}
CTL="${HQ_BACKSTOP_CTL:-$HOME/.claude/hq/backstop-ctl.sh}"

if [ -x "$CTL" ]; then
  "$CTL" "$args" >&2 2>&1
else
  echo "backstop: control script missing at $CTL — reinstall with: node scripts/backstop-install.mjs" >&2
fi

exit 2

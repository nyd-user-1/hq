#!/bin/bash
# hq backstop — client-side control.
#
# This runs entirely on the machine: no model call, no tokens, and it works
# when the API is refusing every request. That is the whole point — at the wall
# the model cannot answer, so the thing that unfreezes the sessions must not
# need it.
PORT="${HQ_BACKSTOP_PORT:-3141}"
BASE="http://127.0.0.1:${PORT}/_backstop"

arg="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]/')"

# Pull one string/number field out of a small JSON object without jq.
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" | head -1; }

if ! out=$(curl -s --max-time 5 "${BASE}/status" 2>/dev/null) || [ -z "$out" ]; then
  echo "backstop: gateway is not answering on 127.0.0.1:${PORT}."
  echo "          start it with:  launchctl kickstart -k gui/$(id -u)/com.hq.backstop"
  exit 1
fi

case "$arg" in
  off|stop|release|down)
    out=$(curl -s --max-time 5 -X POST "${BASE}/off")
    printf '\n  ◇ backstop released — sessions are back on your own plan.\n\n'
    ;;

  status|info)
    mode=$(field "$out" mode); prov=$(field "$out" provider)
    spent=$(field "$out" spentUsd); reqs=$(field "$out" requests)
    plan=$(field "$out" planStatus); last=$(field "$out" lastLimitAt)
    if [ "$mode" = "on" ]; then
      printf '\n  ◆ backstop ENGAGED via %s — $%.4f drawn over %s requests.\n' "$prov" "${spent:-0}" "${reqs:-0}"
    else
      printf '\n  ◇ backstop standing by (%s) — you are on your own plan.\n' "${prov:-bedrock}"
      [ -n "$spent" ] && [ "$spent" != "0" ] && printf '     lifetime drawdown: $%.4f over %s requests\n' "$spent" "${reqs:-0}"
    fi
    [ -n "$plan" ] && printf '     plan signal: %s\n' "$plan"
    [ -n "$last" ] && printf '     last wall hit: %s\n' "$last"
    printf '\n'
    ;;

  *)
    out=$(curl -s --max-time 8 -X POST "${BASE}/on" \
      -H 'content-type: application/json' \
      -d '{"reason":"/backstop"}')
    prov=$(field "$out" provider)
    printf '\n  ◆ backstop engaged — every open session is live again on hq capacity (%s).\n' "${prov:-bedrock}"
    printf '     Keep working. Nothing was restarted. /backstop off to release.\n\n'
    ;;
esac

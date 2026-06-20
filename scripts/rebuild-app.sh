#!/usr/bin/env bash
# rebuild-app.sh — ONE command to refresh the installed HQ.app with the latest
# committed code on `main`. The .app bundles its OWN standalone Next server
# (Resources/standalone/server.js), so just restarting the running app can't pick
# up new code — the bundle has to be rebuilt. This: brings the native worktree up
# to main → builds the offline bundle → runs the packaging script → relaunches.
#
#   npm run app:rebuild                 # rebuild + relaunch HQ.app
#   npm run app:rebuild -- --no-launch  # rebuild only (relaunch yourself)
#
# Safe to run while `next dev` (:3002) is live: the build happens in the SEPARATE
# hq-native worktree (its own .next), never main's .next — so it can't clobber the
# dev server (the "Launchpad" stale-cache trap in AGENTS.md).
set -euo pipefail

# Find the worktree that has native-packaging checked out; fall back to the
# conventional path.
NATIVE="$(git worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{w=substr($0,10)} /^branch refs\/heads\/native-packaging$/{print w; exit}')"
NATIVE="${NATIVE:-$HOME/code/hq-native}"
[ -d "$NATIVE/scripts" ] || { echo "✗ native worktree not found at: $NATIVE"; exit 1; }

echo "▸ bringing native-packaging up to main ($NATIVE)…"
git -C "$NATIVE" merge --ff-only main \
  || { echo "✗ native-packaging diverged from main — resolve manually (it should be a strict ancestor of main)."; exit 1; }

echo "▸ building the offline bundle…"
( cd "$NATIVE" && env -u NODE_ENV npm run build:offline >/dev/null )

echo "▸ repackaging HQ.app…"
( cd "$NATIVE" && bash scripts/make-macos-app-native.sh | tail -2 )

if [ "${1:-}" = "--no-launch" ]; then
  echo "✓ HQ.app rebuilt. Quit + reopen it (⌘Space 'HQ') to load the new bundle."
else
  echo "▸ relaunching HQ.app…"
  pkill -f "HQ.app/Contents/MacOS/hq" 2>/dev/null || true
  sleep 1
  open "${HQ_APP_INSTALL:-$HOME/Applications}/HQ.app" 2>/dev/null \
    && echo "✓ HQ.app is current and relaunched." \
    || echo "✓ HQ.app rebuilt — open it from Spotlight (⌘Space 'HQ')."
fi

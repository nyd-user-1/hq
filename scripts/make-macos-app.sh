#!/usr/bin/env bash
# make-macos-app.sh — wrap the offline HQ build into a self-contained macOS
# HQ.app you can find in Spotlight and pin to the Dock. No Electron, no signing.
#
# The app COPIES .next/standalone inside itself, so it's relocatable and won't
# break if the source repo/worktree is deleted. It still uses the system `node`
# (Option 1). Build the offline bundle first:  npm run build:offline
#
# Re-run this any time after a rebuild to refresh the app.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE="$REPO/.next/standalone"
APP_NAME="HQ"
PORT="${HQ_APP_PORT:-3009}"                 # own port; never clashes with dev :3002
INSTALL_DIR="${HQ_APP_INSTALL:-$HOME/Applications}"
APP="$INSTALL_DIR/$APP_NAME.app"

[ -f "$STANDALONE/server.js" ] || {
  echo "No offline build at $STANDALONE"
  echo "Build it first:  (cd \"$REPO\" && npm run build:offline)"
  exit 1
}

echo "Building $APP (port $PORT) ..."
mkdir -p "$INSTALL_DIR"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# --- self-contained: copy the standalone server bundle into the app ---------
cp -R "$STANDALONE" "$APP/Contents/Resources/standalone"

# --- icon: black bg, white "hq" -> .icns (python3+PIL, then iconutil) --------
ICONSET="$(mktemp -d)/HQ.iconset"; mkdir -p "$ICONSET"
python3 - "$ICONSET" <<'PY'
import sys, os
from PIL import Image, ImageDraw, ImageFont
iconset = sys.argv[1]
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 255))
d = ImageDraw.Draw(img)
for fp in ("/System/Library/Fonts/HelveticaNeue.ttc",
           "/System/Library/Fonts/Helvetica.ttc",
           "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
           "/Library/Fonts/Arial.ttf"):
    if os.path.exists(fp):
        try:
            font = ImageFont.truetype(fp, int(S * 0.46)); break
        except Exception:
            font = None
else:
    font = None
if font is None:
    font = ImageFont.load_default()
text = "hq"
bb = d.textbbox((0, 0), text, font=font)
w, h = bb[2] - bb[0], bb[3] - bb[1]
d.text(((S - w) / 2 - bb[0], (S - h) / 2 - bb[1]), text, font=font, fill=(255, 255, 255, 255))
for s in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = s * scale
        name = f"icon_{s}x{s}{'@2x' if scale == 2 else ''}.png"
        img.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
PY
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/hq.icns"

# --- Info.plist --------------------------------------------------------------
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>HQ</string>
  <key>CFBundleDisplayName</key><string>HQ</string>
  <key>CFBundleIdentifier</key><string>com.nysgpt.hq</string>
  <key>CFBundleExecutable</key><string>hq</string>
  <key>CFBundleIconFile</key><string>hq</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# --- launcher executable (GUI apps get a minimal PATH -> set it ourselves) ---
cat > "$APP/Contents/MacOS/hq" <<'EXE'
#!/bin/bash
# HQ.app — start the bundled offline server (if needed) and open it.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
NODE="$(command -v node || echo /usr/local/bin/node)"
HERE="$(cd "$(dirname "$0")/../Resources/standalone" && pwd)"
PORT=__PORT__
BASE="http://localhost:$PORT"
up() { /usr/bin/curl -sf -o /dev/null --max-time 2 "$BASE/"; }
if ! up; then
  ( cd "$HERE" && PORT=$PORT HOSTNAME=127.0.0.1 nohup "$NODE" server.js >/tmp/hq-app.log 2>&1 & )
  for _ in $(seq 1 50); do up && break; sleep 0.4; done
fi
/usr/bin/open "$BASE/"
EXE
/usr/bin/sed -i '' "s/__PORT__/$PORT/" "$APP/Contents/MacOS/hq"
chmod +x "$APP/Contents/MacOS/hq"

# --- register with LaunchServices so Spotlight indexes it now -----------------
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" || true
touch "$APP"

echo "Done -> $APP"
echo "Find it in Spotlight (⌘Space, type 'HQ'). Opens HQ at http://localhost:$PORT"
